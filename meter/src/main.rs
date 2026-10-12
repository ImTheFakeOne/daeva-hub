//! Daeva Meter: the capture and damage parser from the A2Tools DPS Meter
//! (https://github.com/taengu/A2Tools-DPS-Meter, GPL-3.0), run without a window.
//! Daeva Hub starts it and reads one JSON object per line from stdout:
//!
//!   {"type":"status","npcap":true}
//!   {"type":"dps","data":{...DpsData...},"ping":42,"me":{"name":"…","serverId":2001,"class":"Gladiator","level":45}}
//!
//! and may write commands to stdin, one per line: `reset`, `quit`.
//!
//! Everything under capture/, combat/, entity/, i18n/, clock.rs, supporters.rs
//! and platform/{win32,unsupported}/ is A2Tools' code, unchanged (see
//! A2TOOLS_COMMIT). logging/ and share/ are stand-ins that do nothing: this
//! meter keeps no packet logs and uploads nothing.

#![allow(dead_code, unexpected_cfgs)]

mod capture;
mod clock;
mod combat;
mod entity;
mod i18n;
mod logging;
mod platform;
mod share;
mod supporters;

use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use capture::captured_payload::CapturedPayload;
use capture::combat_port_detector::CombatPortDetector;
use capture::pcap_capturer::PcapCapturer;
use combat::capture_dispatcher::CaptureDispatcher;
use combat::data_storage::DataStorage;
use combat::dps_calculator::DpsCalculator;
use combat::ping_tracker::PingTracker;
use i18n::lookup::{NpcLookup, SkillLookup};

fn arg(name: &str) -> Option<String> {
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        if a == name {
            return it.next();
        }
    }
    None
}

fn emit(value: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    if serde_json::to_writer(&mut out, &value).is_ok() {
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }
}

fn data_dir() -> PathBuf {
    if let Some(d) = arg("--data") {
        return PathBuf::from(d);
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("data")
}

fn main() {
    let data = data_dir();
    let language = arg("--lang").unwrap_or_else(|| "en".to_string());

    let skill_lookup = SkillLookup::new();
    let npc_lookup = NpcLookup::new();
    let mut dot_ids: HashSet<i32> = HashSet::new();
    if let Ok(text) = std::fs::read_to_string(data.join("dot_skill_ids.json")) {
        if let Ok(ids) = serde_json::from_str::<Vec<i32>>(&text) {
            dot_ids.extend(ids);
        }
    }
    i18n::lookup::load_language(&skill_lookup, &npc_lookup, &data, &language);
    let skill_lookup = Arc::new(skill_lookup);
    let npc_lookup = Arc::new(npc_lookup);

    let data_storage = Arc::new(DataStorage::new());
    if let Ok(text) = std::fs::read_to_string(data.join("abnormals.json")) {
        data_storage.set_abnormal_stack_limits(capture::abnormal::stack_limits(&text));
    }
    let ping_tracker = Arc::new(PingTracker::new());
    let port_detector = Arc::new(CombatPortDetector::new());
    let mut calculator = DpsCalculator::new(data_storage.clone(), skill_lookup.clone(), npc_lookup.clone(), ping_tracker.clone());

    // Commands from Daeva Hub, read on their own thread.
    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if cmd_tx.send(line.trim().to_string()).is_err() {
                break;
            }
        }
        let _ = cmd_tx.send("quit".to_string()); // Daeva Hub went away
    });

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    runtime.block_on(async move {
        let npcap = platform::pcap::library_available();
        emit(serde_json::json!({ "type": "status", "npcap": npcap }));

        let (tx, rx) = tokio::sync::mpsc::channel::<CapturedPayload>(4096);
        let capturer = PcapCapturer::new(tx);
        if npcap {
            capturer.start();
        }
        let mut dispatcher = CaptureDispatcher::new(
            data_storage.clone(),
            skill_lookup.clone(),
            npc_lookup.clone(),
            port_detector.clone(),
            ping_tracker.clone(),
        );
        dispatcher.set_dot_skill_ids(dot_ids);
        tokio::spawn(async move {
            dispatcher.run(rx).await;
        });

        let mut tick = tokio::time::interval(Duration::from_millis(500));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd.as_str() {
                    "reset" => {
                        calculator.restart_target_selection(true);
                        data_storage.forget_guessed_nicknames();
                        data_storage.hide_party_placeholders();
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                }
            }
            let dps = calculator.get_dps();
            let me = data_storage.local_profile();
            emit(serde_json::json!({
                "type": "dps",
                "data": dps,
                "ping": ping_tracker.current_ping_ms(),
                "me": {
                    "name": me.name,
                    "serverId": me.server_id,
                    "class": me.class.map(|c| c.class_name()),
                    "level": me.level,
                },
            }));
        }
    });
}

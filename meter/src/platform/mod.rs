//! The two OS pieces the meter needs from A2Tools' `platform` module: loading
//! Npcap, and finding the AION2 window. Windows gets the real ones; anything
//! else gets A2Tools' "unsupported" twins, which compile and do nothing.

#[cfg(windows)]
#[path = "win32/pcap.rs"]
pub mod pcap;
#[cfg(windows)]
#[path = "win32/window_detector.rs"]
pub mod window_detector;

#[cfg(not(windows))]
#[path = "unsupported/pcap.rs"]
pub mod pcap;
#[cfg(not(windows))]
#[path = "unsupported/window_detector.rs"]
pub mod window_detector;

use crate::capture::captured_payload::CapturedPayload;

/// A2Tools writes raw traffic here when packet logging is on. Daeva Meter never does.
#[inline]
pub fn log_packet(_cap: &CapturedPayload) {}

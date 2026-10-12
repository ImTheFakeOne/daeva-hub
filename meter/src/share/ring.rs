use crate::capture::captured_payload::CapturedPayload;

/// A2Tools keeps recent traffic here for fight uploads. Daeva Meter never does.
#[inline]
pub fn record(_cap: &CapturedPayload) {}

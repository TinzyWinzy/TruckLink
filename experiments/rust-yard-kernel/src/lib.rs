//! Experimental synthetic yard-capacity kernel. Never evaluates or authorizes release.

/// Process precomputed arrivals, acceptance flags and service durations as one batch.
/// Output triples are (wait, turnaround, 1-based dock); blocked rows use NaN, NaN, 0.
///
/// # Safety
/// Input pointers must be aligned and readable for `count` items; output must be
/// writable for `3 * count` f64 items. Output must not overlap any input buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulate_batch(
    arrivals: *const f64,
    accepted: *const u8,
    durations: *const f64,
    count: usize,
    docks: usize,
    output: *mut f64,
) -> i32 {
    if count == 0
        || count > 1_000_000
        || docks == 0
        || docks > 10_000
        || arrivals.is_null()
        || accepted.is_null()
        || durations.is_null()
        || output.is_null()
    {
        return 1;
    }
    // Buffers belong to the Python caller and remain alive for this synchronous call.
    let (arrivals, accepted, durations, output) = unsafe {
        (
            std::slice::from_raw_parts(arrivals, count),
            std::slice::from_raw_parts(accepted, count),
            std::slice::from_raw_parts(durations, count),
            std::slice::from_raw_parts_mut(output, count * 3),
        )
    };
    if arrivals
        .iter()
        .chain(durations)
        .any(|v| !v.is_finite() || *v < 0.0)
        || accepted.iter().any(|v| *v > 1)
        || arrivals.windows(2).any(|pair| pair[0] > pair[1])
    {
        return 2;
    }
    let mut available = vec![0.0_f64; docks];
    for i in 0..count {
        let row = &mut output[i * 3..i * 3 + 3];
        if accepted[i] == 0 {
            row.copy_from_slice(&[f64::NAN, f64::NAN, 0.0]);
            continue;
        }
        // Strict comparison keeps Python's lowest-index tie behavior.
        let mut bay = 0;
        for candidate in 1..docks {
            if available[candidate] < available[bay] {
                bay = candidate;
            }
        }
        let start = arrivals[i].max(available[bay]);
        available[bay] = start + durations[i];
        row.copy_from_slice(&[
            start - arrivals[i],
            available[bay] - arrivals[i],
            (bay + 1) as f64,
        ]);
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ties_blocked_rows_and_waiting_match_the_reference() {
        let mut out = [0.0; 12];
        let result = unsafe {
            simulate_batch(
                [0.0, 0.0, 0.0, 1.0].as_ptr(),
                [1, 1, 0, 1].as_ptr(),
                [5.0, 5.0, 5.0, 2.0].as_ptr(),
                4,
                2,
                out.as_mut_ptr(),
            )
        };
        assert_eq!(result, 0);
        assert_eq!(&out[..6], &[0.0, 5.0, 1.0, 0.0, 5.0, 2.0]);
        assert!(out[6].is_nan() && out[7].is_nan());
        assert_eq!(&out[9..], &[4.0, 6.0, 1.0]);
    }

    #[test]
    fn invalid_inputs_return_status_without_running() {
        let mut out = [17.0; 3];
        let result = unsafe {
            simulate_batch(
                [f64::NAN].as_ptr(),
                [1].as_ptr(),
                [1.0].as_ptr(),
                1,
                1,
                out.as_mut_ptr(),
            )
        };
        assert_eq!(result, 2);
        assert_eq!(out, [17.0; 3]);
        let result = unsafe {
            simulate_batch(
                [0.0].as_ptr(),
                [1].as_ptr(),
                [1.0].as_ptr(),
                1,
                0,
                out.as_mut_ptr(),
            )
        };
        assert_eq!(result, 1);
    }
}

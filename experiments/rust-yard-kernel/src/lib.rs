//! Experimental synthetic yard-capacity kernel. Never evaluates or authorizes release.
//!
//! Two bindings share one core:
//! - a hand-written C ABI (`simulate_batch`) for the ctypes benchmark harness, and
//! - a PyO3 module (`trucki_yard_kernel`) packaged by maturin for production adoption.
//! Numerical behaviour, ties and error cases stay identical between the two.

/// Shared scheduling core. Writes 3 f64 per movement into `output`:
/// (wait, turnaround, 1-based dock); blocked rows use NaN, NaN, 0.
/// Returns Err(status) for invalid inputs (1: shape/size, 2: value).
fn simulate_core(
    arrivals: &[f64],
    accepted: &[u8],
    durations: &[f64],
    docks: usize,
    output: &mut [f64],
) -> Result<(), i32> {
    let count = arrivals.len();
    if count == 0
        || count > 1_000_000
        || docks == 0
        || docks > 10_000
        || accepted.len() != count
        || durations.len() != count
        || output.len() != count * 3
    {
        return Err(1);
    }
    if arrivals
        .iter()
        .chain(durations)
        .any(|v| !v.is_finite() || *v < 0.0)
        || accepted.iter().any(|v| *v > 1)
        || arrivals.windows(2).any(|pair| pair[0] > pair[1])
    {
        return Err(2);
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
    Ok(())
}

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
        || docks == 0
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
    simulate_core(arrivals, accepted, durations, docks, output)
        .map(|_ok| 0)
        .unwrap_or_else(|code| code)
}

// --- PyO3 module (packaged with maturin) -------------------------------------

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyfunction(name = "simulate_batch")]
fn simulate_batch_py(
    arrivals: Vec<f64>,
    accepted: Vec<u8>,
    durations: Vec<f64>,
    docks: usize,
) -> PyResult<Vec<(f64, f64, u32)>> {
    let count = arrivals.len();
    let mut output = vec![0.0_f64; count * 3];
    simulate_core(&arrivals, &accepted, &durations, docks, &mut output).map_err(|code| {
        PyValueError::new_err(match code {
            1 => "invalid shapes: arrays must be equal non-empty length, docks 1..=10000, result under 1 million rows",
            2 => "invalid values: arrivals/durations must be finite and non-negative, sorted arrivals, accepted in 0..=1",
            _ => "unexpected kernel failure",
        })
    })?;
    Ok(output
        .chunks_exact(3)
        .map(|row| (row[0], row[1], row[2] as u32))
        .collect())
}

#[pymodule]
fn trucki_yard_kernel(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(simulate_batch_py, module)?)?;
    Ok(())
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

    #[test]
    fn core_matches_c_abi_on_shared_fixture() {
        let mut abi_out = [0.0; 12];
        let status = unsafe {
            simulate_batch(
                [0.0, 0.0, 0.0, 1.0].as_ptr(),
                [1, 1, 0, 1].as_ptr(),
                [5.0, 5.0, 5.0, 2.0].as_ptr(),
                4,
                2,
                abi_out.as_mut_ptr(),
            )
        };
        assert_eq!(status, 0);
        let mut core_out = [0.0; 12];
        let core = simulate_core(
            &[0.0, 0.0, 0.0, 1.0],
            &[1, 1, 0, 1],
            &[5.0, 5.0, 5.0, 2.0],
            2,
            &mut core_out,
        );
        assert!(core.is_ok());
        assert_eq!(
            abi_out.iter().map(|v| v.to_bits()).collect::<Vec<u64>>(),
            core_out.iter().map(|v| v.to_bits()).collect::<Vec<u64>>()
        );
    }
}

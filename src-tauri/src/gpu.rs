//! GPU readings for the GPU widget (hub topic `gpu`).
//!
//! Every adapter is listed through DXGI and measured with the GPU performance counters Windows
//! keeps for Task Manager (load = busiest engine type, dedicated VRAM in use), which works for any
//! vendor. NVIDIA cards are read through NVML instead (nvml.dll ships with the driver), which adds
//! temperature, power, fan and clock. The counters also name the processes holding the most VRAM.

use serde::Serialize;

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    /// Busiest engine, 0–100.
    pub load: f64,
    pub mem_used: u64,
    pub mem_total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp: Option<u32>,
    /// Watts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_limit: Option<f64>,
    /// Percent of max fan speed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fan: Option<u32>,
    /// Graphics clock, MHz.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct VramUser {
    pub pid: u32,
    pub name: String,
    pub path: String,
    pub mem: u64,
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct Sample {
    pub gpus: Vec<GpuInfo>,
    /// Processes using the most dedicated VRAM, all adapters together.
    pub top: Vec<VramUser>,
}

#[cfg(windows)]
pub use imp::Gpu;

#[cfg(not(windows))]
#[derive(Default)]
pub struct Gpu;

#[cfg(not(windows))]
impl Gpu {
    pub fn new() -> Self {
        Gpu
    }
    pub fn sample(&mut self, _top: usize) -> Sample {
        Sample::default()
    }
}

/// `pid_123_luid_0x00000000_0x0000f9fd_phys_0_eng_0_engtype_3d` → (pid, luid, engine type).
fn parse_instance(name: &str) -> (Option<u32>, Option<&str>, Option<&str>) {
    let pid = name.strip_prefix("pid_").and_then(|r| r.split('_').next()).and_then(|p| p.parse().ok());
    let luid = name.find("luid_").and_then(|i| name.get(i + 5..i + 26));
    let eng = name.rfind("engtype_").map(|i| &name[i + 8..]);
    (pid, luid, eng)
}

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::ffi::c_void;

    use windows::core::{s, w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HMODULE};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::System::Performance::*;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

    use super::{parse_instance, GpuInfo, Sample, VramUser};

    pub struct Gpu {
        adapters: Vec<Adapter>,
        nvml: Option<Nvml>,
        counters: Option<Counters>,
        names: HashMap<u32, (String, String)>,
    }

    struct Adapter {
        name: String,
        luid: String,
        total: u64,
    }

    impl Gpu {
        pub fn new() -> Self {
            Gpu { adapters: adapters(), nvml: Nvml::load(), counters: Counters::open(), names: HashMap::new() }
        }

        pub fn sample(&mut self, top: usize) -> Sample {
            let mut load: HashMap<String, f64> = HashMap::new();
            let mut used: HashMap<String, f64> = HashMap::new();
            let mut by_pid: HashMap<u32, f64> = HashMap::new();
            if let Some(c) = &self.counters {
                // SAFETY: the query and its counters live as long as `c`.
                unsafe { PdhCollectQueryData(c.query) };
                // Load per adapter: sum over processes per engine type, then the busiest type.
                let mut engines: HashMap<(String, String), f64> = HashMap::new();
                for (name, v) in c.read(c.engine) {
                    if let (_, Some(luid), Some(eng)) = parse_instance(&name) {
                        *engines.entry((luid.to_owned(), eng.to_owned())).or_default() += v;
                    }
                }
                for ((luid, _), v) in engines {
                    let l = load.entry(luid).or_default();
                    *l = l.max(v.min(100.0));
                }
                for (name, v) in c.read(c.adapter_mem) {
                    if let (_, Some(luid), _) = parse_instance(&name) {
                        used.insert(luid.to_owned(), v);
                    }
                }
                for (name, v) in c.read(c.process_mem) {
                    if let (Some(pid), _, _) = parse_instance(&name) {
                        *by_pid.entry(pid).or_default() += v;
                    }
                }
            }

            let mut nv: Vec<GpuInfo> = self.nvml.as_ref().map(|n| n.read()).unwrap_or_default();
            let mut gpus = Vec::new();
            for a in &self.adapters {
                // A second LUID for the same card (Parsec and other virtual displays) has no memory
                // counters of its own.
                if self.counters.is_some() && !used.contains_key(&a.luid) {
                    continue;
                }
                let info = match nv.iter().position(|g| g.name == a.name) {
                    Some(i) => nv.remove(i),
                    None => GpuInfo {
                        name: a.name.clone(),
                        load: load.get(&a.luid).copied().unwrap_or(0.0),
                        mem_used: used.get(&a.luid).copied().unwrap_or(0.0) as u64,
                        mem_total: a.total,
                        ..Default::default()
                    },
                };
                gpus.push(info);
            }
            gpus.extend(nv); // NVML cards DXGI did not list (should not happen)

            let mut pids: Vec<(u32, f64)> = by_pid.into_iter().filter(|(_, v)| *v > 0.0).collect();
            pids.sort_by(|a, b| b.1.total_cmp(&a.1));
            if self.names.len() > 512 {
                self.names.clear();
            }
            let top = pids
                .into_iter()
                .filter_map(|(pid, mem)| {
                    let (name, path) = self.names.entry(pid).or_insert_with(|| process_name(pid)).clone();
                    (!name.is_empty()).then_some(VramUser { pid, name, path, mem: mem as u64 })
                })
                .take(top)
                .collect();
            Sample { gpus, top }
        }
    }

    /// Hardware adapters with their own memory: skips WARP and virtual display adapters.
    fn adapters() -> Vec<Adapter> {
        let mut out = Vec::new();
        // SAFETY: plain DXGI enumeration; every out-param is owned here.
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
            let mut i = 0;
            while let Ok(a) = factory.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = a.GetDesc1() else { continue };
                if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 || d.DedicatedVideoMemory == 0 {
                    continue;
                }
                let len = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
                out.push(Adapter {
                    name: String::from_utf16_lossy(&d.Description[..len]).trim().to_owned(),
                    luid: format!("0x{:08x}_0x{:08x}", d.AdapterLuid.HighPart as u32, d.AdapterLuid.LowPart),
                    total: d.DedicatedVideoMemory as u64,
                });
            }
        }
        out
    }

    fn process_name(pid: u32) -> (String, String) {
        // SAFETY: the handle is closed before returning; the buffer outlives the call.
        unsafe {
            let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return Default::default() };
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            if !ok {
                return Default::default();
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let name = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            (name, path)
        }
    }

    struct Counters {
        query: PDH_HQUERY,
        engine: PDH_HCOUNTER,
        adapter_mem: PDH_HCOUNTER,
        process_mem: PDH_HCOUNTER,
    }

    impl Counters {
        fn open() -> Option<Self> {
            // SAFETY: handles are written by PDH and closed in Drop.
            unsafe {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                let add = |path: PCWSTR| {
                    let mut c = PDH_HCOUNTER::default();
                    (PdhAddEnglishCounterW(query, path, 0, &mut c) == 0).then_some(c)
                };
                let (Some(engine), Some(adapter_mem), Some(process_mem)) = (
                    add(w!(r"\GPU Engine(*)\Utilization Percentage")),
                    add(w!(r"\GPU Adapter Memory(*)\Dedicated Usage")),
                    add(w!(r"\GPU Process Memory(*)\Dedicated Usage")),
                ) else {
                    PdhCloseQuery(query);
                    return None;
                };
                // Rates need two samples: prime the first one now.
                PdhCollectQueryData(query);
                Some(Counters { query, engine, adapter_mem, process_mem })
            }
        }

        /// Every instance of a wildcard counter with a valid value.
        fn read(&self, counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
            let fmt = PDH_FMT(PDH_FMT_DOUBLE.0 | 0x8000); // PDH_FMT_NOCAP100
            let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            // SAFETY: PDH writes at most `size` bytes into a buffer at least that large and
            // properly aligned for its items; the names it points at live inside the same buffer.
            unsafe {
                let (mut size, mut count) = (0u32, 0u32);
                if PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, None) != PDH_MORE_DATA {
                    return Vec::new();
                }
                let mut buf: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> = Vec::with_capacity(size as usize / item + 1);
                if PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, Some(buf.as_mut_ptr())) != 0 {
                    return Vec::new();
                }
                buf.set_len(count as usize);
                buf.iter()
                    .filter(|i| i.FmtValue.CStatus <= 1) // PDH_CSTATUS_VALID_DATA / NEW_DATA
                    .map(|i| (i.szName.to_string().unwrap_or_default(), i.FmtValue.Anonymous.doubleValue))
                    .collect()
            }
        }
    }

    impl Drop for Counters {
        fn drop(&mut self) {
            // SAFETY: closes the query opened in `open`, with its counters.
            unsafe { PdhCloseQuery(self.query) };
        }
    }

    type Device = *mut c_void;

    #[repr(C)]
    struct Utilization {
        gpu: u32,
        _memory: u32,
    }

    #[repr(C)]
    struct Memory {
        total: u64,
        _free: u64,
        used: u64,
    }

    /// The few NVML calls the widget needs, loaded at run time so PieDesk starts without NVIDIA.
    struct Nvml {
        devices: Vec<(String, Device)>,
        shutdown: unsafe extern "C" fn() -> i32,
        utilization: unsafe extern "C" fn(Device, *mut Utilization) -> i32,
        memory: unsafe extern "C" fn(Device, *mut Memory) -> i32,
        temperature: unsafe extern "C" fn(Device, u32, *mut u32) -> i32,
        power: unsafe extern "C" fn(Device, *mut u32) -> i32,
        power_limit: unsafe extern "C" fn(Device, *mut u32) -> i32,
        fan: unsafe extern "C" fn(Device, *mut u32) -> i32,
        clock: unsafe extern "C" fn(Device, u32, *mut u32) -> i32,
    }

    unsafe fn sym<T: Copy>(lib: HMODULE, name: windows::core::PCSTR) -> Option<T> {
        let f = GetProcAddress(lib, name)?;
        // SAFETY (caller): `T` is the exact fn-pointer type of the export.
        Some(std::mem::transmute_copy(&f))
    }

    impl Nvml {
        fn load() -> Option<Self> {
            // SAFETY: each symbol is cast to the signature documented in nvml.h; device handles
            // stay valid until nvmlShutdown in Drop.
            unsafe {
                let lib = LoadLibraryW(w!("nvml.dll")).ok()?;
                let init: unsafe extern "C" fn() -> i32 = sym(lib, s!("nvmlInit_v2"))?;
                if init() != 0 {
                    return None;
                }
                let count_fn: unsafe extern "C" fn(*mut u32) -> i32 = sym(lib, s!("nvmlDeviceGetCount_v2"))?;
                let handle: unsafe extern "C" fn(u32, *mut Device) -> i32 = sym(lib, s!("nvmlDeviceGetHandleByIndex_v2"))?;
                let name_fn: unsafe extern "C" fn(Device, *mut u8, u32) -> i32 = sym(lib, s!("nvmlDeviceGetName"))?;
                let mut n = 0u32;
                count_fn(&mut n);
                let mut devices = Vec::new();
                for i in 0..n {
                    let mut d: Device = std::ptr::null_mut();
                    if handle(i, &mut d) != 0 {
                        continue;
                    }
                    let mut buf = [0u8; 96];
                    name_fn(d, buf.as_mut_ptr(), buf.len() as u32);
                    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    devices.push((String::from_utf8_lossy(&buf[..len]).trim().to_owned(), d));
                }
                Some(Nvml {
                    devices,
                    shutdown: sym(lib, s!("nvmlShutdown"))?,
                    utilization: sym(lib, s!("nvmlDeviceGetUtilizationRates"))?,
                    memory: sym(lib, s!("nvmlDeviceGetMemoryInfo"))?,
                    temperature: sym(lib, s!("nvmlDeviceGetTemperature"))?,
                    power: sym(lib, s!("nvmlDeviceGetPowerUsage"))?,
                    power_limit: sym(lib, s!("nvmlDeviceGetEnforcedPowerLimit"))?,
                    fan: sym(lib, s!("nvmlDeviceGetFanSpeed"))?,
                    clock: sym(lib, s!("nvmlDeviceGetClockInfo"))?,
                })
            }
        }

        fn read(&self) -> Vec<GpuInfo> {
            fn ok<T>(code: i32, v: T) -> Option<T> {
                (code == 0).then_some(v)
            }
            // SAFETY: valid device handles and out-params of the documented types.
            unsafe {
                self.devices
                    .iter()
                    .map(|(name, d)| {
                        let mut u = Utilization { gpu: 0, _memory: 0 };
                        let mut m = Memory { total: 0, _free: 0, used: 0 };
                        let (mut t, mut p, mut pl, mut f, mut c) = (0u32, 0u32, 0u32, 0u32, 0u32);
                        let load = ok((self.utilization)(*d, &mut u), u.gpu).unwrap_or(0) as f64;
                        (self.memory)(*d, &mut m);
                        GpuInfo {
                            name: name.clone(),
                            load,
                            mem_used: m.used,
                            mem_total: m.total,
                            temp: ok((self.temperature)(*d, 0, &mut t), t), // NVML_TEMPERATURE_GPU
                            power: ok((self.power)(*d, &mut p), p as f64 / 1000.0),
                            power_limit: ok((self.power_limit)(*d, &mut pl), pl as f64 / 1000.0),
                            fan: ok((self.fan)(*d, &mut f), f),
                            clock: ok((self.clock)(*d, 0, &mut c), c), // NVML_CLOCK_GRAPHICS
                        }
                    })
                    .collect()
            }
        }
    }

    impl Drop for Nvml {
        fn drop(&mut self) {
            // SAFETY: balances the nvmlInit_v2 in `load`.
            unsafe { (self.shutdown)() };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_counter_instances() {
        let (pid, luid, eng) = parse_instance("pid_15308_luid_0x00000000_0x0000f9fd_phys_0_eng_0_engtype_3d");
        assert_eq!((pid, luid, eng), (Some(15308), Some("0x00000000_0x0000f9fd"), Some("3d")));
        let (pid, luid, eng) = parse_instance("luid_0x00000000_0x0000f9fd_phys_0");
        assert_eq!((pid, luid, eng), (None, Some("0x00000000_0x0000f9fd"), None));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "reads this machine's GPU"]
    fn live_gpu() {
        let mut g = Gpu::new();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let s = g.sample(5);
        println!("{}", serde_json::to_string_pretty(&s).unwrap());
        assert!(!s.gpus.is_empty());
    }
}

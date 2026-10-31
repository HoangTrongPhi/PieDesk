//! Stable monitor identities.
//!
//! The GDI name Tauri reports (`\\.\DISPLAY1`) is handed out in enumeration order and changes
//! after a reboot, a driver update or replugging. Layouts are keyed by the monitor's device path
//! from `QueryDisplayConfig` instead: it carries the EDID product code plus the connector
//! instance, so the same screen on the same port keeps its id.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// Stable key stored in boxes / widgets.
    pub id: String,
    /// Friendly name from the EDID ("DELL U2720Q"); empty for some built-in panels.
    pub name: String,
}

/// GDI device name (`\\.\DISPLAY1`) → identity, for every active display.
#[cfg(windows)]
pub fn identities() -> HashMap<String, Identity> {
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
        DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };

    let wide = |s: &[u16]| String::from_utf16_lossy(&s[..s.iter().position(|&c| c == 0).unwrap_or(s.len())]);
    let mut out = HashMap::new();
    unsafe {
        let (mut np, mut nm) = (0u32, 0u32);
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut np, &mut nm).is_err() {
            return out;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
        if QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &mut np, paths.as_mut_ptr(), &mut nm, modes.as_mut_ptr(), None).is_err() {
            return out;
        }
        paths.truncate(np as usize);
        for p in &paths {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = p.sourceInfo.adapterId;
            source.header.id = p.sourceInfo.id;
            let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            target.header.adapterId = p.targetInfo.adapterId;
            target.header.id = p.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != 0 || DisplayConfigGetDeviceInfo(&mut target.header) != 0 {
                continue;
            }
            let gdi = wide(&source.viewGdiDeviceName);
            let id = wide(&target.monitorDevicePath).to_lowercase();
            if gdi.is_empty() || id.is_empty() {
                continue;
            }
            // Mirrored displays share a source: the first target names it.
            out.entry(gdi).or_insert(Identity { id, name: wide(&target.monitorFriendlyDeviceName) });
        }
    }
    out
}

#[cfg(not(windows))]
pub fn identities() -> HashMap<String, Identity> {
    HashMap::new()
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(windows)]
    fn every_active_display_has_a_device_path() {
        let ids = super::identities();
        assert!(!ids.is_empty());
        assert!(ids.values().all(|i| i.id.starts_with(r"\\?\display#")), "{ids:#?}");
    }
}

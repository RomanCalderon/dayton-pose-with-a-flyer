use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraRecord {
    pub label: String,
    pub symlink: String,
    pub serial: String,
    pub usb_port: String,
    pub vendor_id: String,
    pub product_id: String,
    pub infrared: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraList {
    pub platform: String,
    pub implemented: bool,
    pub cameras: Vec<CameraRecord>,
    pub note: String,
}

pub fn looks_infrared(label: &str) -> bool {
    let lower = label.to_ascii_lowercase();
    lower.contains("infrared")
        || lower.contains("windows hello")
        || lower.contains(" ir camera")
        || lower.ends_with(" ir")
}

pub fn vid_pid_from_text(value: &str) -> (String, String) {
    let lower = value.to_ascii_lowercase().replace('\\', "/");
    let vendor = capture_token(&lower, "vid_").or_else(|| capture_token(&lower, "vid"));
    let product = capture_token(&lower, "pid_").or_else(|| capture_token(&lower, "pid"));
    (vendor.unwrap_or_default(), product.unwrap_or_default())
}

fn capture_token(haystack: &str, key: &str) -> Option<String> {
    let start = haystack.find(key)? + key.len();
    let rest = &haystack[start..];
    let token: String = rest
        .chars()
        .take_while(|ch| ch.is_ascii_hexdigit())
        .collect();
    if token.len() < 4 {
        return None;
    }
    Some(token[..4].to_ascii_uppercase())
}

/// `USB\VID_046D&PID_085E\29317058` -> `29317058`.
/// Interface instance ids (`7&2ab55389&0&0000`) are not serials.
pub fn serial_from_instance_id(instance: &str) -> Option<String> {
    let segment = instance.rsplit(['\\', '#']).next()?.trim();
    if segment.is_empty() || segment.contains('&') || segment.contains('{') {
        return None;
    }
    if segment.eq_ignore_ascii_case("global") {
        return None;
    }
    Some(segment.to_string())
}

pub fn list_cameras() -> CameraList {
    #[cfg(windows)]
    {
        match windows_cameras() {
            Ok(cameras) => CameraList {
                platform: "windows".to_string(),
                implemented: true,
                cameras,
                note: "Media Foundation friendly names plus USB serial when CfgMgr32 can see the parent.".to_string(),
            },
            Err(error) => CameraList {
                platform: "windows".to_string(),
                implemented: true,
                cameras: Vec::new(),
                note: format!("Camera enumeration failed: {error}"),
            },
        }
    }
    #[cfg(not(windows))]
    {
        CameraList {
            platform: std::env::consts::OS.to_string(),
            implemented: false,
            cameras: Vec::new(),
            note: "USB serial enumeration is implemented for Windows. This platform returns no pinned cameras; the web layer uses the first webcam.".to_string(),
        }
    }
}

#[cfg(windows)]
fn windows_cameras() -> Result<Vec<CameraRecord>, String> {
    use std::ptr::null_mut;

    use windows::Win32::{
        Media::MediaFoundation::{
            IMFActivate, IMFAttributes, MFCreateAttributes, MFEnumDeviceSources, MFStartup,
            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, MFSTARTUP_NOSOCKET, MF_VERSION,
        },
        System::Com::CoTaskMemFree,
    };

    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|error| error.to_string())?;
        let mut attributes: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attributes, 1).map_err(|error| error.to_string())?;
        let attributes = attributes.ok_or("MFCreateAttributes returned nothing")?;
        attributes
            .SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )
            .map_err(|error| error.to_string())?;

        let mut source_ptr: *mut Option<IMFActivate> = null_mut();
        let mut count: u32 = 0;
        MFEnumDeviceSources(&attributes, &mut source_ptr, &mut count).map_err(|error| error.to_string())?;

        let mut cameras = Vec::new();
        if count > 0 && !source_ptr.is_null() {
            let slice = std::slice::from_raw_parts_mut(source_ptr, count as usize);
            for slot in slice {
                if let Some(activate) = slot.take() {
                    if let Some(record) = record_from_activate(&activate) {
                        cameras.push(record);
                    }
                }
            }
            CoTaskMemFree(Some(source_ptr as _));
        }
        Ok(cameras)
    }
}

#[cfg(windows)]
fn record_from_activate(activate: &windows::Win32::Media::MediaFoundation::IMFActivate) -> Option<CameraRecord> {
    use windows::core::Interface;
    use windows::Win32::Media::MediaFoundation::{
        IMFAttributes, MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
    };

    let attrs = activate.cast::<IMFAttributes>().ok()?;
    let label = read_allocated_string(&attrs, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)?;
    let symlink = read_allocated_string(&attrs, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK)
        .unwrap_or_default();
    let (vendor_id, product_id) = vid_pid_from_text(&symlink);
    let (serial, usb_port) = identity_from_symlink(&symlink);
    Some(CameraRecord {
        infrared: looks_infrared(&label),
        label,
        symlink,
        serial,
        usb_port,
        vendor_id,
        product_id,
    })
}

#[cfg(windows)]
fn read_allocated_string(
    attrs: &windows::Win32::Media::MediaFoundation::IMFAttributes,
    key: &windows::core::GUID,
) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;

    let mut value = PWSTR::null();
    let mut len = 0u32;
    unsafe {
        attrs.GetAllocatedString(key, &mut value, &mut len).ok()?;
        if value.is_null() {
            return None;
        }
        let text = value.to_string().ok();
        CoTaskMemFree(Some(value.as_ptr() as _));
        text
    }
}

#[cfg(windows)]
fn identity_from_symlink(symlink: &str) -> (String, String) {
    use windows::{
        core::PCWSTR,
        Win32::{
            Devices::{
                DeviceAndDriverInstallation::{
                    CM_Get_Parent, CM_Locate_DevNodeW, CM_LOCATE_DEVNODE_NORMAL, CR_SUCCESS,
                },
                Properties::{DEVPKEY_Device_InstanceId, DEVPKEY_Device_LocationPaths},
            },
        },
    };

    let wide = pcwstr(symlink);
    let Some(instance) = device_interface_string(&wide, &DEVPKEY_Device_InstanceId) else {
        return (String::new(), String::new());
    };
    let mut node = 0u32;
    let instance_wide = pcwstr(&instance);
    let located = unsafe {
        CM_Locate_DevNodeW(&mut node, PCWSTR(instance_wide.as_ptr()), CM_LOCATE_DEVNODE_NORMAL)
    };
    if located != CR_SUCCESS {
        return (serial_from_instance_id(&instance).unwrap_or_default(), String::new());
    }
    let mut parent = 0u32;
    let parent_result = unsafe { CM_Get_Parent(&mut parent, node, 0) };
    let serial = if parent_result == CR_SUCCESS {
        device_id(parent)
            .and_then(|id| serial_from_instance_id(&id))
            .unwrap_or_default()
    } else {
        serial_from_instance_id(&instance).unwrap_or_default()
    };
    let port = device_node_string(parent, &DEVPKEY_Device_LocationPaths)
        .or_else(|| device_node_string(node, &DEVPKEY_Device_LocationPaths))
        .unwrap_or_default();
    (serial, port)
}

#[cfg(windows)]
fn pcwstr(value: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn device_interface_string(wide: &[u16], key: &windows::Win32::Foundation::DEVPROPKEY) -> Option<String> {
    use windows::{
        core::PCWSTR,
        Win32::Devices::{
            DeviceAndDriverInstallation::{CM_Get_Device_Interface_PropertyW, CR_SUCCESS},
            Properties::DEVPROPTYPE,
        },
    };

    unsafe {
        let mut kind = DEVPROPTYPE(0);
        let mut size = 0u32;
        let _ = CM_Get_Device_Interface_PropertyW(PCWSTR(wide.as_ptr()), key, &mut kind, None, &mut size, 0);
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        let status = CM_Get_Device_Interface_PropertyW(
            PCWSTR(wide.as_ptr()),
            key,
            &mut kind,
            Some(buffer.as_mut_ptr()),
            &mut size,
            0,
        );
        if status != CR_SUCCESS {
            return None;
        }
        wide_from_bytes(&buffer)
    }
}

#[cfg(windows)]
fn device_id(node: u32) -> Option<String> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::{CM_Get_Device_IDW, CR_SUCCESS};

    let mut buffer = vec![0u16; 512];
    let status = unsafe { CM_Get_Device_IDW(node, &mut buffer[..], 0) };
    if status != CR_SUCCESS {
        return None;
    }
    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}

#[cfg(windows)]
fn device_node_string(node: u32, key: &windows::Win32::Foundation::DEVPROPKEY) -> Option<String> {
    use windows::Win32::Devices::{
        DeviceAndDriverInstallation::{CM_Get_DevNode_PropertyW, CR_SUCCESS},
        Properties::DEVPROPTYPE,
    };

    if node == 0 {
        return None;
    }
    unsafe {
        let mut kind = DEVPROPTYPE(0);
        let mut size = 0u32;
        let _ = CM_Get_DevNode_PropertyW(node, key, &mut kind, None, &mut size, 0);
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        let status = CM_Get_DevNode_PropertyW(node, key, &mut kind, Some(buffer.as_mut_ptr()), &mut size, 0);
        if status != CR_SUCCESS {
            return None;
        }
        wide_from_bytes(&buffer)
    }
}

#[cfg(windows)]
fn wide_from_bytes(buffer: &[u8]) -> Option<String> {
    if buffer.len() < 2 {
        return None;
    }
    let mut units = Vec::with_capacity(buffer.len() / 2);
    for chunk in buffer.chunks_exact(2) {
        units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    let end = units.iter().position(|ch| *ch == 0).unwrap_or(units.len());
    if end == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&units[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_brio_ids() {
        let (vendor, product) = vid_pid_from_text(
            r"\\?\usb#vid_046d&pid_085e&mi_00#7&2ab55389&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global",
        );
        assert_eq!(vendor, "046D");
        assert_eq!(product, "085E");
        assert_eq!(
            serial_from_instance_id(r"USB\VID_046D&PID_085E\29317058").as_deref(),
            Some("29317058")
        );
        assert!(serial_from_instance_id(r"USB\VID_046D&PID_085E&MI_00\7&2ab55389&0&0000").is_none());
        assert!(looks_infrared("Logitech BRIO Infrared"));
        assert!(!looks_infrared("Kiosk Brio Photo"));
    }
}

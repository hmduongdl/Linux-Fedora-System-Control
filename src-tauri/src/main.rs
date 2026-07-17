#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sp_system_monitor_lib::run()
}

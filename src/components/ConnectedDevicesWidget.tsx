import { memo, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bluetooth, Check, LoaderCircle, Plus, Radio, RefreshCw, Usb, X } from "lucide-react";
import { StatusPill } from "./widgets/factory";
import { dashboardFetchQueue } from "../lib/dashboardFetchQueue";

interface Device { address: string; name: string; connected: boolean; paired: boolean; trusted: boolean }
interface UsbDevice { id: string; name: string; manufacturer: string | null; vendor_id: string; product_id: string; kind: string }
interface BluetoothState { powered: boolean; discovering: boolean; devices: Device[]; usb_devices: UsbDevice[] }

export const ConnectedDevicesWidget = memo(function ConnectedDevicesWidget() {
  const [state, setState] = useState<BluetoothState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setState(await invoke("get_bluetooth_state")); setError(null); }
    catch (reason) { setError(String(reason)); }
  }, []);
  useEffect(() => {
    // USB/Bluetooth enumeration is optional for the first paint and can be
    // noticeably slow on systems with many devices.
    return dashboardFetchQueue.register("connected-devices", refresh, { initialDelayMs: 1_000 });
  }, [refresh]);

  const scan = async () => {
    setBusy("scan"); setError(null);
    try { setState(await invoke("scan_bluetooth_devices")); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  };
  const connect = async (device: Device) => {
    setBusy(device.address); setError(null);
    try { setState(await invoke("connect_bluetooth_device", { address: device.address })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  };
  const connected = state?.devices.filter((d) => d.connected) ?? [];
  const available = state?.devices.filter((d) => !d.connected) ?? [];

  return <div className="glass-panel flex min-h-[150px] flex-col gap-3 p-[clamp(10px,1.2vh,16px)]">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2"><Bluetooth size={14} className="text-purple-400" /><h3 className="header-small-caps text-[10px] text-purple-300 md:text-[11px]">CONNECTED DEVICES</h3></div>
      {state ? <StatusPill tone="green">{connected.length + state.usb_devices.length} connected</StatusPill> : <div className="skeleton h-5 w-20 rounded-full" />}
    </div>
    <div className="space-y-1.5">
      {connected.map((device) => <div key={device.address} className="flex items-center gap-2.5 rounded-lg border border-purple-400/20 bg-purple-400/[.06] px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-400/10 text-purple-300"><Bluetooth size={13} /></span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-slate-200">{device.name}</strong><small className="block font-mono text-[8px] text-slate-500">BT address · {device.address}</small></span><Check size={12} className="text-emerald-400" />
      </div>)}
      {state?.usb_devices.map((device) => <div key={device.id} className="flex items-center gap-2.5 rounded-lg border border-cyan-accent/15 bg-cyan-accent/[.04] px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-accent/10 text-cyan-accent"><Usb size={13} /></span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-slate-200">{device.name}</strong><small className="block truncate font-mono text-[8px] text-slate-500">{device.kind} · {device.vendor_id}:{device.product_id}{device.manufacturer && device.manufacturer !== device.name ? ` · ${device.manufacturer}` : ""}</small></span><Check size={12} className="text-emerald-400" />
      </div>)}
      {state && connected.length === 0 && state.usb_devices.length === 0 && <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-[9px] text-slate-500">No connected device</div>}
      {!state && !error && <div className="skeleton h-12 w-full rounded-lg" />}
    </div>
    {error && <p className="rounded-md bg-red-400/10 px-2 py-1.5 text-[9px] text-red-300">{error}</p>}
    <button type="button" onClick={() => { setPickerOpen(true); void scan(); }} disabled={busy !== null} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-purple-400/25 bg-purple-400/10 text-[9px] font-bold uppercase tracking-wider text-purple-300 hover:bg-purple-400/15 disabled:opacity-50">
      {busy === "scan" ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />} Add Bluetooth device
    </button>

    {pickerOpen && <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="glass-panel w-full max-w-md border-white/10 bg-[#11131d] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-purple-300">Add Bluetooth device</h3><p className="mt-0.5 text-[9px] text-slate-500">Select a discovered device to pair and connect</p></div><button onClick={() => setPickerOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X size={15} /></button></div>
        {error && <p className="mb-2 rounded-md bg-red-400/10 px-2 py-1.5 text-[9px] text-red-300">{error}</p>}
        <div className="custom-scrollbar max-h-64 space-y-1 overflow-y-auto">
          {available.map((device) => <button key={device.address} onClick={() => void connect(device)} disabled={busy !== null} className="flex w-full items-center gap-2.5 rounded-lg border border-white/[.06] bg-black/15 px-3 py-2.5 text-left hover:border-purple-400/25 hover:bg-purple-400/[.05] disabled:opacity-50">
            <Radio size={14} className="shrink-0 text-purple-300" /><span className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-slate-200">{device.name}</strong><small className="font-mono text-[8px] text-slate-500">{device.address}{device.paired ? " · Paired" : ""}</small></span>{busy === device.address && <LoaderCircle size={12} className="animate-spin text-purple-300" />}
          </button>)}
          {busy === "scan" && <div className="flex items-center justify-center gap-2 py-8 text-[10px] text-slate-400"><LoaderCircle size={14} className="animate-spin text-purple-300" /> Scanning nearby devices…</div>}
          {busy !== "scan" && available.length === 0 && <div className="py-8 text-center text-[10px] text-slate-500">No available devices found</div>}
        </div>
        <button onClick={() => void scan()} disabled={busy !== null} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-[9px] font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw size={11} className={busy === "scan" ? "animate-spin" : ""} /> Scan again</button>
      </div>
    </div>}
  </div>;
});

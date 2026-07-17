function App() {
  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <header className="flex items-center justify-between px-2 py-1 border-b border-[#2A2B3C]">
        <h1 className="text-sm font-bold tracking-widest text-[#00F0FF] uppercase">
          SP Monitor
        </h1>
        <span className="text-[10px] text-[#555577]">v0.1.0</span>
      </header>
      <main className="flex-1 flex flex-col gap-2">
        <section className="rounded border border-[#2A2B3C] bg-[#12131C] p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8888AA] mb-2">
            System
          </h2>
          <p className="text-xs text-[#555577]">Telemetry loading...</p>
        </section>
        <section className="rounded border border-[#2A2B3C] bg-[#12131C] p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8888AA] mb-2">
            Audio
          </h2>
          <p className="text-xs text-[#555577]">Mixer loading...</p>
        </section>
        <section className="rounded border border-[#2A2B3C] bg-[#12131C] p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8888AA] mb-2">
            Media
          </h2>
          <p className="text-xs text-[#555577]">MPRIS loading...</p>
        </section>
      </main>
    </div>
  );
}

export default App;

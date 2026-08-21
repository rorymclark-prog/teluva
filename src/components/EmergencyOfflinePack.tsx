import { ShieldAlert } from 'lucide-react';
import { loadEmergencyPack } from '../utils/emergencyPack';
import EmergencyView from './EmergencyView';

export default function EmergencyOfflinePack() {
  const pack = loadEmergencyPack();
  if (!pack) {
    return (
      <main className="min-h-screen bg-ink-900 text-white p-5 grid place-items-center font-sans">
        <section className="max-w-md text-center">
          <div className="w-14 h-14 mx-auto grid place-items-center rounded-2xl bg-rosa-500/20 text-rosa-100"><ShieldAlert className="h-6 w-6" /></div>
          <h1 className="mt-5 font-display text-3xl font-semibold">No emergency pack on this device.</h1>
          <p className="mt-3 text-sm text-white/60 leading-relaxed">Open Emergency while online, choose Save offline pack, then use its test button before relying on it.</p>
          <a href="/" className="btn-primary inline-flex mt-6">Return to Teluva</a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-cream-100 p-3 sm:p-6 font-sans ember-emergency-pack-page">
      <EmergencyView members={pack.members} country={pack.country} emberMode packMode savedPack={pack} />
    </main>
  );
}

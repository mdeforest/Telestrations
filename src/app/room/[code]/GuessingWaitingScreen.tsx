import React from "react";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  players: Player[];
  localPlayerId: string;
}

export function GuessingWaitingScreen({ players, localPlayerId }: Props) {
  return (
    <main className="flex-1 px-6 pt-8 pb-32 max-w-md mx-auto w-full space-y-8 z-40 relative">
      {/* Confirmation Header */}
      <section className="text-center space-y-4 transform -rotate-1">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-primary rounded-full sketch-shadow-primary mb-2">
          <span className="material-symbols-outlined text-on-primary text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h2 className="font-headline font-extrabold text-4xl text-primary tracking-tight">Nice Guess!</h2>
        <p className="font-body text-on-surface-variant font-medium">Your ink has dried. Now we wait for the others...</p>
      </section>

      {/* Player Status List */}
      <section className="bg-surface-container-low rounded-xl p-6 transform rotate-[1.5deg] relative shadow-sm border border-outline-variant/10">
        <h3 className="font-label uppercase tracking-widest text-xs font-bold text-tertiary-dim mb-4 opacity-70">Room Status</h3>
        <div className="space-y-3">
          {players.map((p, i) => {
            const isMe = p.id === localPlayerId;
            const initials = p.nickname.slice(0, 2).toUpperCase();

            if (isMe) {
              return (
                <div key={p.id} className="flex items-center justify-between bg-primary-container p-3 rounded-xl border-2 border-primary sketch-shadow-primary transform -rotate-[1deg]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-on-primary font-headline font-bold">
                      {initials}
                    </div>
                    <span className="font-body font-bold text-on-primary-container">You</span>
                  </div>
                  <span className="font-label text-xs font-bold text-on-primary-container tracking-widest uppercase">
                    SUBMITTED
                  </span>
                </div>
              );
            }

            // Others (Assuming still working)
            return (
              <div key={p.id} className="flex items-center justify-between bg-surface-container-high p-3 rounded-xl border border-outline-variant/5 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-tertiary-fixed-dim rounded-full flex items-center justify-center text-on-tertiary-fixed font-headline font-bold">
                    {initials}
                  </div>
                  <span className="font-body font-semibold text-on-surface">{p.nickname}</span>
                </div>
                <span className="font-label text-xs font-bold text-on-surface-variant italic animate-pulse uppercase tracking-wider">
                  Thinking...
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Engagement Content: Pro Tip */}
      <section className="bg-tertiary-container rounded-xl p-6 relative overflow-hidden sketch-shadow mt-8">
        <div className="absolute -right-4 -top-4 opacity-10">
          <span className="material-symbols-outlined text-9xl">lightbulb</span>
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2 text-on-tertiary-container">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>tips_and_updates</span>
            <span className="font-label font-bold text-sm uppercase tracking-wider">Pro Tip</span>
          </div>
          <p className="font-body text-on-tertiary-container leading-relaxed font-medium">
            Don't worry about being perfect; messy doodles win hearts! Sometimes the funniest guesses come from the most chaotic drawings.
          </p>
        </div>
      </section>

      {/* Next Round Preview Banner */}
      <section className="bg-secondary-dim text-on-secondary p-5 rounded-xl sketch-shadow-secondary flex items-center gap-4 mt-6 transform -rotate-[0.5deg]">
        <div className="bg-secondary-fixed text-on-secondary-fixed p-3 rounded-lg flex items-center justify-center">
          <span className="material-symbols-outlined text-3xl">theaters</span>
        </div>
        <div>
          <h4 className="font-headline font-bold text-lg leading-tight">Drawing Phase Next</h4>
          <p className="font-body text-xs opacity-80 mt-1 font-medium">Prepare to turn those words into a masterpiece.</p>
        </div>
      </section>
    </main>
  );
}

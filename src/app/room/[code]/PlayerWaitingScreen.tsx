
interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  players: Player[];
  localPlayerId: string;
  phase: "drawing" | "guess";
  submittedPlayerIds?: string[];
}

export function PlayerWaitingScreen({ players, localPlayerId, phase, submittedPlayerIds }: Props) {
  return (
    <main className="flex-grow container mx-auto px-4 py-8 max-w-4xl z-40 relative">
      {/* Status Header */}
      <header className="text-center mb-12">
        <div className="inline-block bg-primary px-8 py-4 rounded-xl sketch-shadow mb-6 transform -rotate-1">
          <h1 className="font-headline text-3xl md:text-5xl text-on-primary font-black uppercase tracking-tight flex items-center gap-3">
            <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            You&apos;re all set!
          </h1>
        </div>
        <p className="font-body text-xl text-on-surface-variant max-w-md mx-auto">
          {phase === "drawing" 
            ? "Your masterpiece has been tucked into the folder. Now we wait for the other artists."
            : "Your guess is locked in! Hang tight while the rest of the table finishes."}
        </p>
      </header>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Waiting Indicator & List */}
        <div className="md:col-span-7 space-y-8">
          <div className="bg-surface-container-lowest p-8 rounded-xl paper-stack border border-outline-variant/10 shadow-[0px_10px_30px_rgba(49,46,41,0.05)]">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-headline text-2xl font-bold flex items-center gap-2">
                Waiting for others...
              </h2>
              <div className="flex gap-1 animate-pulse">
                <div className="w-3 h-3 bg-tertiary rounded-full"></div>
                <div className="w-3 h-3 bg-tertiary rounded-full opacity-60"></div>
                <div className="w-3 h-3 bg-tertiary rounded-full opacity-30"></div>
              </div>
            </div>

            {/* Player List */}
            <div className="space-y-4">
              {players.map((p, i) => {
                // Determine styling based on whether it's the local player (assumed done) or others (assumed doodling)
                const isMe = p.id === localPlayerId;
                const isDone = isMe || (submittedPlayerIds?.includes(p.id) ?? false);
                const isFirstColor = i % 2 === 0;

                if (isMe) {
                  return (
                    <div key={p.id} className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/5">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${isFirstColor ? 'bg-secondary-fixed border-secondary' : 'bg-primary-container border-primary'}`}>
                          <span className={`material-symbols-outlined ${isFirstColor ? 'text-secondary' : 'text-primary'}`}>{isFirstColor ? 'face_6' : 'face_4'}</span>
                        </div>
                        <span className="font-headline font-bold text-lg">{p.nickname} (You)</span>
                      </div>
                      <div className="flex items-center gap-2 text-primary font-bold">
                        <span className="font-label text-xs uppercase tracking-widest hidden sm:inline">Done!</span>
                        <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
                      </div>
                    </div>
                  );
                }

                // Others — show done or working based on submittedPlayerIds
                return (
                  <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border ${isDone ? "bg-surface-container-low border-outline-variant/5" : "bg-surface-container-high border-outline-variant/5 shadow-inner"}`}>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-tertiary-fixed flex items-center justify-center border-2 border-tertiary">
                        <span className="material-symbols-outlined text-tertiary-dim">face_3</span>
                      </div>
                      <span className="font-headline font-bold text-lg">{p.nickname}</span>
                    </div>
                    {isDone ? (
                      <div className="flex items-center gap-2 text-primary font-bold">
                        <span className="font-label text-xs uppercase tracking-widest hidden sm:inline">Done!</span>
                        <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-on-surface-variant italic opacity-80">
                        <span className="font-label text-xs uppercase tracking-widest hidden sm:inline">Working...</span>
                        <span className="material-symbols-outlined text-sm animate-bounce">edit</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Side Content: Pro Tip & Activity */}
        <div className="md:col-span-5 space-y-8">
          {/* Pro Tip Card */}
          <div className="bg-secondary p-8 rounded-xl sketch-shadow-secondary transform rotate-1 border-2 border-secondary-dim">
            <div className="flex items-center gap-3 mb-4 text-on-secondary">
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
              <h3 className="font-headline font-black text-xl uppercase tracking-tight">Pro Tip!</h3>
            </div>
            <p className="font-body text-on-secondary leading-relaxed mb-6 font-medium">
              Don&apos;t worry about being a &ldquo;good&rdquo; artist. The most hilarious moments in Telestrations happen when a simple circle becomes a world-class disaster!
            </p>
            <div className="bg-on-secondary/10 p-4 rounded-xl border border-on-secondary/20 shadow-inner">
              <p className="font-label text-[10px] uppercase tracking-widest text-on-secondary/80 mb-1">Next Round Preview</p>
              <p className="font-headline text-on-secondary font-black text-lg">
                {phase === 'drawing' ? 'Guessing Mode' : 'Drawing Mode'}
              </p>
            </div>
          </div>

          {/* Fun Placeholder/Sketch */}
          <div className="bg-surface-container-highest p-8 rounded-xl flex flex-col items-center justify-center text-center opacity-80 border-2 border-dashed border-outline-variant/30">
            <span className="material-symbols-outlined text-6xl text-outline-variant/40 mb-4 animate-pulse">gesture</span>
            <p className="font-label text-xs text-on-surface-variant font-bold uppercase tracking-widest">Did you know?</p>
            <p className="font-body text-sm text-on-surface-variant mt-2 font-medium">The world&apos;s longest doodle is over 10km long!</p>
          </div>
        </div>
      </div>
    </main>
  );
}

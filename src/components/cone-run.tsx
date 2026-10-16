import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coffee,
  Footprints,
  HardHat,
  Layers,
  Magnet,
  Pause,
  Play,
  Rocket,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { ConeGame, type Cause, type Hud, type Nudge } from "@/game/engine";

const CAUSE: Record<Cause, { title: string; line: string }> = {
  cone: { title: "Baril.", line: "That drum does not move." },
  pit: { title: "Nid-de-poule.", line: "Montreal left that one for you." },
  barrier: { title: "Barricade.", line: "Jersey barrier, one. You, zero." },
  scaffold: { title: "Échafaudage.", line: "That beam was not a suggestion." },
  truck: { title: "Truck.", line: "It was parked. You were not." },
  pillar: { title: "Colonne.", line: "That one holds the tunnel up." },
  sign: { title: "Enseigne.", line: "Slide. The métro does not duck." },
};

function fmt(n: number) {
  return Math.max(0, Math.floor(n)).toLocaleString("en-CA");
}

export function ConeRun() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ConeGame | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let game: ConeGame | null = null;
    try {
      game = new ConeGame(canvas, (next) => {
        if (alive) setHud(next);
      });
      gameRef.current = game;
    } catch (err) {
      console.error(err);
      if (alive) setFailed(true);
    }
    return () => {
      alive = false;
      game?.dispose();
      gameRef.current = null;
    };
  }, []);

  const phase = hud?.phase ?? "attract";
  const heat = hud?.heat ?? 0;

  const press = (action: Nudge) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    gameRef.current?.nudge(action);
  };

  return (
    <main
      className="relative h-dvh w-full overflow-hidden bg-bg text-fg select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 90px rgba(255, 90, 31, ${heat * 0.45})` }}
      />

      {phase === "playing" || phase === "paused" ? (
        <PlayingHud hud={hud} onPause={() => gameRef.current?.pause()} onMute={() => gameRef.current?.toggleMute()} />
      ) : null}

      {phase === "attract" ? (
        <Menu
          best={hud?.best ?? 0}
          muted={hud?.muted ?? false}
          failed={failed}
          onPlay={() => {
            gameRef.current?.unlock();
            gameRef.current?.play();
          }}
          onMute={() => gameRef.current?.toggleMute()}
        />
      ) : null}

      {phase === "paused" ? (
        <Overlay>
          <p className="font-display text-4xl text-yellow">PAUSED</p>
          <p className="mt-2 text-muted">The cones are still there.</p>
          <button
            type="button"
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-orange font-display text-xl text-bg"
            onClick={() => gameRef.current?.resume()}
          >
            <Play className="size-5" />
            Resume
          </button>
        </Overlay>
      ) : null}

      {phase === "dead" && hud ? (
        <Overlay>
          <p className="text-sm tracking-widest text-yellow">WIPED OUT</p>
          <h2 className="mt-1 font-display text-5xl leading-none text-orange">
            {CAUSE[hud.cause ?? "cone"].title}
          </h2>
          <p className="mt-3 text-muted">{CAUSE[hud.cause ?? "cone"].line}</p>
          <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
            <Stat label="Score" value={fmt(hud.score)} />
            <Stat label="Metres" value={fmt(hud.meters)} />
            <Stat label="Cafés" value={fmt(hud.coins)} />
          </dl>
          {hud.newBest ? (
            <p className="mt-4 font-display text-yellow">NEW BEST</p>
          ) : (
            <p className="mt-4 text-sm text-muted">Best {fmt(hud.best)}</p>
          )}
          <button
            type="button"
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-orange font-display text-xl text-bg"
            onPointerDown={(e) => {
              e.preventDefault();
              gameRef.current?.unlock();
              gameRef.current?.play();
            }}
          >
            Run it back
          </button>
        </Overlay>
      ) : null}

      {phase === "playing" ? (
        <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-4 gap-2 p-3 pb-4">
          <Pad label="Left" onPointerDown={press("left")}>
            <ChevronLeft />
          </Pad>
          <Pad label="Slide" onPointerDown={press("slide")}>
            <ChevronDown />
          </Pad>
          <Pad label="Jump" onPointerDown={press("jump")}>
            <ChevronUp />
          </Pad>
          <Pad label="Right" onPointerDown={press("right")}>
            <ChevronRight />
          </Pad>
        </div>
      ) : null}

      {hud?.hint && phase === "playing" ? (
        <p className="pointer-events-none absolute inset-x-0 top-24 z-10 text-center font-display text-2xl text-yellow drop-shadow-sm">
          {hud.hint}
        </p>
      ) : null}
      {hud?.callout && phase === "playing" ? (
        <p className="pointer-events-none absolute inset-x-0 top-36 z-10 text-center font-display text-xl text-orange">
          {hud.callout}
        </p>
      ) : null}
    </main>
  );
}

function PlayingHud({
  hud,
  onPause,
  onMute,
}: {
  hud: Hud | null;
  onPause: () => void;
  onMute: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
      <div>
        <p className="flex items-baseline gap-2 font-display text-4xl leading-none text-fg">
          {fmt(hud?.score ?? 0)}
          {hud && hud.mult > 1 ? <span className="text-2xl text-orange">x{hud.mult}</span> : null}
        </p>
        <p className="mt-1 flex items-center gap-3 text-sm text-muted">
          <span>{fmt(hud?.meters ?? 0)} m</span>
          <span className="inline-flex items-center gap-1 text-fg">
            <Coffee className="size-4 text-orange" />
            {fmt(hud?.coins ?? 0)}
          </span>
        </p>
        {hud?.mission ? (
          <p className="mt-1 text-xs text-muted">
            {hud.mission.index}/{hud.mission.total} {hud.mission.label}{" "}
            {fmt(hud.mission.progress)}/{fmt(hud.mission.goal)}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          {hud?.hat ? <HardHat className="size-5 text-yellow" aria-label="Hard hat" /> : null}
          {hud && hud.magnet > 0 ? <Magnet className="size-5 text-orange" aria-label="Magnet" /> : null}
          {hud && hud.boots > 0 ? <Footprints className="size-5 text-yellow" aria-label="Steel-toe boots" /> : null}
          {hud && hud.jet > 0 ? <Rocket className="size-5 text-orange" aria-label="Propane jet" /> : null}
          {hud && hud.board > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-yellow" aria-label="Plywood board">
              <Layers className="size-5" />
              <span className="text-xs">{hud.board}</span>
            </span>
          ) : null}
          {hud && hud.boost > 0 ? <Zap className="size-5 text-yellow" aria-label="Double espresso" /> : null}
          <span className="flex gap-1" aria-hidden="true">
            {[-1, 0, 1].map((lane) => (
              <span
                key={lane}
                className={
                  "size-2 rounded-full " + (hud?.lane === lane ? "bg-orange" : "bg-line")
                }
              />
            ))}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <IconButton label={hud?.muted ? "Unmute" : "Mute"} onClick={onMute}>
          {hud?.muted ? <VolumeX /> : <Volume2 />}
        </IconButton>
        <IconButton label="Pause" onClick={onPause}>
          <Pause />
        </IconButton>
      </div>
    </div>
  );
}

function Menu({
  best,
  muted,
  failed,
  onPlay,
  onMute,
}: {
  best: number;
  muted: boolean;
  failed: boolean;
  onPlay: () => void;
  onMute: () => void;
}) {
  return (
    <>
      <div className="absolute top-4 right-4 z-20">
        <IconButton label={muted ? "Unmute" : "Mute"} onClick={onMute}>
          {muted ? <VolumeX /> : <Volume2 />}
        </IconButton>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-4 pb-8">
        <section className="w-full max-w-md rounded-3xl border border-line bg-surface/90 p-4 backdrop-blur-md">
          <p className="text-xs tracking-widest text-yellow">MONTRÉAL · ENDLESS</p>
          <h1 className="mt-1 font-display text-5xl leading-none text-orange">CÔNE RUN</h1>
          <p className="mt-2 text-sm text-muted">
            Three lanes of orange cones and potholes. Construction season never clocks out.
          </p>
          {failed ? (
            <p className="mt-3 text-sm text-orange">This browser could not start the street.</p>
          ) : null}
          <button
            type="button"
            className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-orange font-display text-2xl text-bg"
            onPointerDown={(e) => {
              e.preventDefault();
              onPlay();
            }}
          >
            Play
          </button>
          <ul className="mt-4 grid gap-2 text-sm text-fg">
            <li className="flex items-center gap-3">
              <ChevronLeft className="size-4 text-orange" />
              <ChevronRight className="size-4 text-orange" />
              Switch lanes — cones and trucks
            </li>
            <li className="flex items-center gap-3">
              <ChevronUp className="size-4 text-yellow" />
              Jump potholes and barricades
            </li>
            <li className="flex items-center gap-3">
              <ChevronDown className="size-4 text-yellow" />
              Slide under scaffolds
            </li>
            <li className="flex items-center gap-3">
              <Zap className="size-4 text-yellow" />
              Bottes, planche, bonbonne, double espresso
            </li>
          </ul>
          <p className="mt-4 text-sm text-muted">
            Best {fmt(best)} · arrows, WASD, or swipe
          </p>
        </section>
      </div>
    </>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center p-4 pb-8">
        <section className="w-full max-w-md rounded-3xl border border-line bg-surface/90 p-6 backdrop-blur-md">
        {children}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-bg px-2 py-3">
      <dt className="text-xs tracking-widest text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl text-fg">{value}</dd>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="pointer-events-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-surface/80 text-fg"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="size-5">{children}</span>
    </button>
  );
}

function Pad({
  label,
  onPointerDown,
  children,
}: {
  label: string;
  onPointerDown: (e: PointerEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface/75 text-fg touch-none"
      onPointerDown={onPointerDown}
    >
      <span className="size-6">{children}</span>
      <span className="text-xs tracking-widest text-muted">{label}</span>
    </button>
  );
}

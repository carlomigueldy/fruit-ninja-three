/// <reference types="vite/client" />

interface Window {
  __fruitNinjaDebug?: {
    spawnFruitAtScreen: (x: number, y: number) => number | null;
    spawnBombAtScreen: (x: number, y: number) => number | null;
    sliceAtScreen: (x: number, y: number) => number;
    getState: () => {
      score: number;
      lives: number;
      gameOver: boolean;
      activeTargets: number;
      trailVisible: boolean;
      muted: boolean;
    };
    toggleMute: () => void;
    restart: () => void;
  };
}

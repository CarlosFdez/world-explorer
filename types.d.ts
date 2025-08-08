import PixiJS from "pixi.js";

declare global {
    type EditingMode = "toggle" | "reveal" | "hide";

    interface WorldExplorerFlags {
        color: string;
        revealRadius: number;
        gridRevealRadius: number;
        opacityGM: number;
        opacityPlayer: number;
        persistExploredAreas: boolean;
        image?: string;
        enabled?: boolean;
        revealedPositions?: [number, number][];
        zIndex: number;
    }

    interface WorldExplorerState {
        clearing: boolean;
        tool: EditingMode;
    }

    namespace globalThis {
        export import PIXI = PixiJS;
    }
}
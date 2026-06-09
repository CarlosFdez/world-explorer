import PixiJS from "pixi.js";

declare global {
    type EditingMode = "toggle" | "reveal" | "hide";

    type CoordsOrOffset = { offset?: unknown; coords?: unknown };
    type Position = "back" | "behindDrawings" | "behindTokens" | "front";

    interface GridEntry {
        offset: { i: number; j: number; };
        reveal: boolean | "partial";
    }

    interface WorldExplorerFlags {
        color: string;
        revealRadius: number;
        gridRevealRadius: number;
        opacityGM: number;
        opacityPlayer: number;
        persistExploredAreas: boolean;
        useSpaces: boolean;
        image?: string;
        enabled?: boolean;
        zIndex: number;
        gridData?: Record<string, GridEntry | undefined>;
        position: Position;
    }

    interface WorldExplorerState {
        clearing: boolean;
        tool: EditingMode;
    }

    namespace globalThis {
        export import PIXI = PixiJS;
    }
}
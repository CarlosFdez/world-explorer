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

interface FlagConfig {
    Scene: {
        "world-explorer": WorldExplorerFlags;
    }
}

interface LenientGlobalVariableTypes {
    game: never; // the type doesn't matter
}
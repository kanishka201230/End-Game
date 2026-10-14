import * as THREE from 'three';

export interface PathSegment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  doorRequired?: number; // 1 or 2
  branch?: 'left' | 'right' | 'main' | 'p1' | 'p2';
}

export const PATH_HALF_WIDTH = 1.75;
export const P1_SPAWN = new THREE.Vector3(-60, 0.2, 90);
export const P2_SPAWN = new THREE.Vector3(60, 0.2, 90);
export const DOOR1_POS = new THREE.Vector3(-12, 0, 10);
export const DOOR2_POS = new THREE.Vector3(12, 0, 10);
export const CUP_POS = new THREE.Vector3(0, 1.8, -220);
export const JUNCTION_POS = new THREE.Vector3(0, 0, -35);
export const DESTINATION_POS = new THREE.Vector3(0, 1.8, -211.5);

/**
 * High-precision waypoints outlining the natural curved forest trails,
 * doors, and the branching junction that splits into Left and Right scenic trails.
 */
function generateCurvedWaypoints(points: [number, number][], samplesPerSeg = 3): THREE.Vector2[] {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
    0.35
  );
  const totalCount = (points.length - 1) * samplesPerSeg;
  const sampled = curve.getPoints(totalCount);
  return sampled.map((p) => new THREE.Vector2(p.x, p.z));
}

// 1. Player 1 curved trail (South-West Spawn -> Door 1)
export const P1_WAYPOINTS: [number, number][] = [
  [-60, 90],
  [-48, 88],
  [-36, 82],
  [-26, 70],
  [-20, 54],
  [-16, 38],
  [-12, 22],
  [-12, 10] // Door 1
];

// Past Door 1 to Junction
export const P1_TO_JUNCTION: [number, number][] = [
  [-12, 10],
  [-12, -2],
  [-10, -16],
  [-6, -26],
  [0, -35] // Main Forest Junction
];

// 2. Player 2 curved trail (South-East Spawn -> Door 2)
export const P2_WAYPOINTS: [number, number][] = [
  [60, 90],
  [48, 88],
  [36, 82],
  [26, 70],
  [20, 54],
  [16, 38],
  [12, 22],
  [12, 10] // Door 2
];

// Past Door 2 to Junction
export const P2_TO_JUNCTION: [number, number][] = [
  [12, 10],
  [12, -2],
  [10, -16],
  [6, -26],
  [0, -35] // Main Forest Junction
];

// 3. Branch A: Left Scenic Trail (Pine Grove & Mossy Boulders)
export const LEFT_BRANCH_WAYPOINTS: [number, number][] = [
  [0, -35],   // Fork start
  [-9, -52],
  [-16, -72],
  [-20, -96],
  [-21, -122],
  [-17, -148],
  [-10, -172],
  [0, -192]   // Merge point
];

// 4. Branch B: Right Ridge Trail (Sunlit Forest Ridge)
export const RIGHT_BRANCH_WAYPOINTS: [number, number][] = [
  [0, -35],   // Fork start
  [9, -52],
  [16, -72],
  [20, -96],
  [21, -122],
  [17, -148],
  [10, -172],
  [0, -192]   // Merge point
];

// 5. Final Summit Walk to the Champion's Cup
export const SUMMIT_WAYPOINTS: [number, number][] = [
  [0, -192],
  [0, -204],
  [0, -211.5]
];

/**
 * Returns a single, strictly ordered sequence of waypoints from Spawn to the Victory Summit.
 * This ensures the character has a clear, non-repeating path to follow and advances monotonically.
 */
export function getOrderedRouteWaypoints(
  role: 1 | 2 = 1,
  selectedBranch: 'left' | 'right' | 'none' = 'left'
): THREE.Vector2[] {
  const isP1 = role === 1;
  const spawnPts = generateCurvedWaypoints(isP1 ? P1_WAYPOINTS : P2_WAYPOINTS, 3);
  const postDoorPts = generateCurvedWaypoints(isP1 ? P1_TO_JUNCTION : P2_TO_JUNCTION, 3);

  const branchChoice = selectedBranch === 'right' ? 'right' : 'left';
  const branchPts = generateCurvedWaypoints(
    branchChoice === 'right' ? RIGHT_BRANCH_WAYPOINTS : LEFT_BRANCH_WAYPOINTS,
    3
  );
  const summitPts = generateCurvedWaypoints(SUMMIT_WAYPOINTS, 3);

  // Concatenate avoiding duplicate connecting points
  const route: THREE.Vector2[] = [...spawnPts];
  for (let i = 1; i < postDoorPts.length; i++) route.push(postDoorPts[i]);
  for (let i = 1; i < branchPts.length; i++) route.push(branchPts[i]);
  for (let i = 1; i < summitPts.length; i++) route.push(summitPts[i]);

  return route;
}

/** Finds the index of the door waypoint along the ordered route */
export function getDoorWaypointIndex(role: 1 | 2, waypoints: THREE.Vector2[]): number {
  const doorPos = role === 1 ? DOOR1_POS : DOOR2_POS;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = Math.hypot(waypoints[i].x - doorPos.x, waypoints[i].y - doorPos.z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function ptsToSegments(
  pts: THREE.Vector2[],
  doorRequired?: number,
  branch: 'left' | 'right' | 'main' | 'p1' | 'p2' = 'main'
): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segments.push({
      a: pts[i].clone(),
      b: pts[i + 1].clone(),
      doorRequired,
      branch
    });
  }
  return segments;
}

/** Generates all continuous curved segments forming the complete Forest arena */
export function buildArenaSegments(): PathSegment[] {
  const p1Pts = generateCurvedWaypoints(P1_WAYPOINTS, 3);
  const p1DoorPts = generateCurvedWaypoints(P1_TO_JUNCTION, 3);

  const p2Pts = generateCurvedWaypoints(P2_WAYPOINTS, 3);
  const p2DoorPts = generateCurvedWaypoints(P2_TO_JUNCTION, 3);

  const leftPts = generateCurvedWaypoints(LEFT_BRANCH_WAYPOINTS, 3);
  const rightPts = generateCurvedWaypoints(RIGHT_BRANCH_WAYPOINTS, 3);
  const summitPts = generateCurvedWaypoints(SUMMIT_WAYPOINTS, 3);

  return [
    ...ptsToSegments(p1Pts, undefined, 'p1'),
    ...ptsToSegments(p1DoorPts, 1, 'p1'),
    ...ptsToSegments(p2Pts, undefined, 'p2'),
    ...ptsToSegments(p2DoorPts, 2, 'p2'),
    ...ptsToSegments(leftPts, undefined, 'left'),
    ...ptsToSegments(rightPts, undefined, 'right'),
    ...ptsToSegments(summitPts, undefined, 'main')
  ];
}

/** Pre-computed array of segments for fast querying */
export const ALL_ARENA_SEGMENTS: PathSegment[] = buildArenaSegments();

/** Filters active walkable segments based on player role, unlocked doors, and chosen junction branch */
export function getActivePathSegments(
  role: 1 | 2 = 1,
  selectedBranch: 'left' | 'right' | 'none' = 'none',
  door1Unlocked = false,
  door2Unlocked = false,
  playerZ = 0
): PathSegment[] {
  return ALL_ARENA_SEGMENTS.filter((seg) => {
    // 1. Role separation before junction
    if (seg.branch === 'p1' && role !== 1) return false;
    if (seg.branch === 'p2' && role !== 2) return false;

    // 2. Door clearance
    if (seg.doorRequired === 1 && !door1Unlocked) return false;
    if (seg.doorRequired === 2 && !door2Unlocked) return false;

    // 3. Branches:
    // Near junction (z between -25 and -42), allow both branches so player can freely steer/choose
    if (playerZ > -42 && playerZ < -25) {
      if (seg.branch === 'left' || seg.branch === 'right') return true;
    }

    if (selectedBranch === 'left' && seg.branch === 'right') return false;
    if (selectedBranch === 'right' && seg.branch === 'left') return false;

    return true;
  });
}

/** Flat array format: [ax, az, bx, bz] for Heightfield */
export const ARENA_PATHS_ARRAY: [number, number, number, number][] = ALL_ARENA_SEGMENTS.map((s) => [
  s.a.x,
  s.a.y,
  s.b.x,
  s.b.y
]);

/**
 * Finds the closest point and distance on the active segments to a 2D world position.
 */
export function findClosestPathPoint(
  x: number,
  z: number,
  segments: PathSegment[]
): { point: THREE.Vector2; distance: number; tangent: THREE.Vector2; segment: PathSegment } {
  const p = new THREE.Vector2(x, z);
  let bestDist = Infinity;
  let bestProj = new THREE.Vector2();
  let bestTangent = new THREE.Vector2(0, -1);
  let bestSeg = segments[0];

  for (const seg of segments) {
    const ab = seg.b.clone().sub(seg.a);
    const lenSq = ab.lengthSq();
    let t = 0;
    if (lenSq > 0.00001) {
      t = ab.dot(p.clone().sub(seg.a)) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const proj = seg.a.clone().add(ab.multiplyScalar(t));
    const d = p.distanceTo(proj);
    if (d < bestDist) {
      bestDist = d;
      bestProj = proj;
      bestSeg = seg;
      const tan = ab.normalize();
      if (tan.lengthSq() > 0.1) {
        bestTangent = tan;
      }
    }
  }

  return { point: bestProj, distance: bestDist, tangent: bestTangent, segment: bestSeg };
}

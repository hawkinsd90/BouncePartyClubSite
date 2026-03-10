# Route Optimization System - Complete Guide

This document provides a comprehensive explanation of how the route optimization system works in the Bounce Party Club application.

---

## Table of Contents

1. [Overview](#overview)
2. [The Complete Flow](#the-complete-flow)
3. [File-by-File Breakdown](#file-by-file-breakdown)
4. [The Optimization Algorithm](#the-optimization-algorithm)
5. [How Tasks Are Chosen and Ordered](#how-tasks-are-chosen-and-ordered)
6. [Example Walkthrough](#example-walkthrough)

---

## Overview

The route optimization system automatically determines the most efficient order to visit multiple delivery/pickup locations in a single route. It uses Google Maps Distance Matrix API to calculate actual driving distances and times between all stops, then applies a greedy nearest-neighbor algorithm with dependency constraints to find an optimal route.

**Primary Goal:** Minimize total driving time while respecting logical constraints (like event start times and dependencies between stops).

---

## The Complete Flow

Here's the complete journey from clicking "Auto-Optimize Route" to seeing the optimized order:

```
User Clicks "Auto-Optimize Route"
         ↓
RouteManagementModal.handleOptimize()
         ↓
useRouteOptimization.optimizeRoute()
         ↓
routeOptimization.optimizeMorningRoute()
         ↓
[Distance Calculation Phase]
distanceCalculator.calculateDistanceMatrix()
         ↓
googleMaps.getGoogleMaps() (loads Google Maps API)
         ↓
Google Distance Matrix API (gets actual distances)
         ↓
[Optimization Phase]
routeOptimization.buildGreedyRoute()
         ↓
routeOptimization.trySwapImprovement()
         ↓
[Mapping Phase]
useRouteOptimization maps optimized stops → tasks
         ↓
RouteManagementModal updates UI with new order
         ↓
User sees optimized route and can save
```

---

## File-by-File Breakdown

### 1. **RouteManagementModal.tsx**
**Location:** `src/components/calendar/RouteManagementModal.tsx`

**Purpose:** UI component that manages the route optimization interface

**Key Functions:**

#### `handleOptimize()`
```typescript
async function handleOptimize() {
  // 1. Ensure all tasks have task_status records in database
  for (const task of localTasks) {
    if (!task.taskStatus) {
      // Create task_status record if missing
    }
  }

  // 2. Log before state
  const beforeOrder = localTasks.map(t => t.customerName).join(', ');

  // 3. Call optimization hook
  const optimizedTasks = await onOptimizeRoute(localTasks);

  // 4. Update local state with optimized order
  setLocalTasks([...optimizedTasks]);

  // 5. Check if order changed and enable save button
  checkForChanges(optimizedTasks);

  // 6. Show success/info message
  if (beforeOrder !== afterOrder) {
    showToast('Route optimized successfully');
  } else {
    showToast('Route is already optimal');
  }
}
```

**State Management:**
- `localTasks`: Current order of tasks in the modal
- `initialTasks`: Original order when modal opened (for cancel/reset)
- `initialOrder`: Task IDs in initial order (for change detection)
- `hasChanges`: Boolean to enable/disable "Save Route" button

---

### 2. **useRouteOptimization.ts**
**Location:** `src/hooks/useRouteOptimization.ts`

**Purpose:** React hook that bridges the UI and the core optimization logic

**Key Function:**

#### `optimizeRoute(tasks: Task[])`
```typescript
async function optimizeRoute(tasks: Task[]): Promise<Task[]> {
  // 1. Transform Task objects into MorningRouteStop objects
  const routeStops: MorningRouteStop[] = tasks.map(task => ({
    id: task.taskStatus?.id || '',
    taskId: task.id,  // IMPORTANT: Preserve original task ID
    orderId: task.orderId,
    address: task.address,
    type: task.type,
    eventStartTime: task.type === 'drop-off'
      ? task.eventStartTime
      : task.eventEndTime,
    equipmentIds: task.equipmentIds,
    numInflatables: task.numInflatables,
  }));

  // 2. Call core optimization function
  const optimizedStops = await optimizeMorningRoute(routeStops);

  // 3. Map optimized stops back to original Task objects
  const optimizedTasks = optimizedStops.map(stop => {
    const task = tasks.find(t => t.id === stop.taskId);
    if (!task) throw new Error('Task not found');
    return task;  // Return same task object, just in new order
  });

  return optimizedTasks;
}
```

**Why this mapping?**
- The optimization algorithm works with lightweight `MorningRouteStop` objects
- Task objects contain lots of extra data (customer info, items, etc.)
- We preserve the `taskId` through optimization so we can map back to original Tasks
- The returned array has the SAME task objects, just in a DIFFERENT order

---

### 3. **routeOptimization.ts**
**Location:** `src/lib/routeOptimization.ts`

**Purpose:** Core optimization algorithm - this is where the magic happens

**Key Types:**

```typescript
interface MorningRouteStop {
  id: string;           // task_status.id
  taskId: string;       // Original task ID (preserved through optimization)
  orderId: string;
  address: string;
  type: 'drop-off' | 'pick-up';
  eventStartTime?: string;
  equipmentIds: string[];
  numInflatables: number;
}

interface StopDependency {
  stopId: string;
  dependsOn: string[];  // This stop must come AFTER these stops
}
```

#### `optimizeMorningRoute(stops: MorningRouteStop[])`
**The main optimization function**

```typescript
export async function optimizeMorningRoute(
  stops: MorningRouteStop[]
): Promise<MorningRouteStop[]> {

  // STEP 1: Build dependency graph
  // Determine which stops MUST come before others
  const dependencies = buildDependencyGraph(stops);

  // STEP 2: Calculate distance matrix
  // Get driving times between ALL pairs of locations
  const distanceMatrix = await calculateDistanceMatrix(
    stops.map(s => s.address)
  );

  // STEP 3: Determine departure time
  // Find earliest event start time, subtract 30 min buffer
  const departureTime = calculateDepartureTime(stops);

  // STEP 4: Build initial greedy route
  // Start from home, always pick nearest unvisited stop
  let route = buildGreedyRoute(
    stops,
    distanceMatrix,
    dependencies,
    departureTime
  );

  // STEP 5: Try swap improvements
  // See if swapping any two stops reduces total distance
  route = trySwapImprovement(
    route,
    distanceMatrix,
    dependencies,
    departureTime
  );

  return route;
}
```

---

### 4. **distanceCalculator.ts**
**Location:** `src/lib/distanceCalculator.ts`

**Purpose:** Calculates actual driving distances and times between locations

#### `calculateDistanceMatrix(addresses: string[])`

```typescript
export async function calculateDistanceMatrix(
  addresses: string[]
): Promise<number[][]> {

  // Create complete list: [HOME, address1, address2, ...]
  const allLocations = [HOME_BASE_ADDRESS, ...addresses];

  // Initialize matrix with infinity (no route found)
  const matrix: number[][] = Array(allLocations.length)
    .fill(null)
    .map(() => Array(allLocations.length).fill(Infinity));

  // Load Google Maps API
  const google = await getGoogleMaps();
  const service = new google.maps.DistanceMatrixService();

  // Google API limits: max 25 origins × 25 destinations per request
  // So we batch the requests
  const BATCH_SIZE = 25;

  for (let i = 0; i < allLocations.length; i += BATCH_SIZE) {
    const originBatch = allLocations.slice(i, i + BATCH_SIZE);

    for (let j = 0; j < allLocations.length; j += BATCH_SIZE) {
      const destinationBatch = allLocations.slice(j, j + BATCH_SIZE);

      // Request distances from origin batch to destination batch
      const result = await service.getDistanceMatrix({
        origins: originBatch,
        destinations: destinationBatch,
        travelMode: google.maps.TravelMode.DRIVING,
      });

      // Parse results and fill matrix
      result.rows.forEach((row, rowIdx) => {
        row.elements.forEach((element, colIdx) => {
          if (element.status === 'OK') {
            // Store duration in minutes
            matrix[i + rowIdx][j + colIdx] =
              element.duration.value / 60;
          }
        });
      });
    }
  }

  return matrix;
}
```

**Example Matrix:**
```
           HOME    Stop1   Stop2   Stop3
HOME       0       15      20      25
Stop1      15      0       8       12
Stop2      20      8       0       10
Stop3      25      12      10      0
```

---

## The Optimization Algorithm

### Phase 1: Build Dependency Graph

**Function:** `buildDependencyGraph(stops)`

**Purpose:** Identify which stops MUST come before others

**Rules:**
1. **Equipment constraints:** If multiple orders need the same inflatable on the same day, deliveries must happen in a specific order based on event times
2. **Same-day pickups:** If we're delivering AND picking up from the same customer, delivery must come first

**Example:**
```typescript
// Order A needs "Bounce House #1" at 10am
// Order B needs "Bounce House #1" at 2pm
// Dependency: Stop A must come before Stop B

const dependencies = [
  { stopId: 'stop-b', dependsOn: ['stop-a'] }
];
```

### Phase 2: Greedy Route Construction

**Function:** `buildGreedyRoute(stops, distanceMatrix, dependencies, departureTime)`

**Algorithm:** Nearest Neighbor with Constraints

```typescript
1. Start at HOME_BASE
2. Track current time (starts at departureTime)
3. While there are unvisited stops:
   a. Find all unvisited stops whose dependencies are satisfied
   b. Among those, find the NEAREST stop (shortest drive time)
   c. Add that stop to route
   d. Update current time (add drive time + setup time)
   e. Mark stop as visited
4. Return to HOME_BASE
```

**Detailed Example:**

```
Stops: A (10am event), B (11am event), C (1pm event)
Distance Matrix:
        HOME   A    B    C
HOME    0      15   25   20
A       15     0    10   18
B       25     10   0    12
C       20     18   12   0

Step 1: At HOME, time = 8:00 AM
  - Unvisited: A, B, C
  - Nearest: A (15 min)
  - Route: [HOME → A]
  - Time: 8:15 AM

Step 2: At A, time = 8:45 AM (8:15 + 30min setup)
  - Unvisited: B, C
  - Nearest: B (10 min from A)
  - Route: [HOME → A → B]
  - Time: 9:25 AM (8:45 + 10 + 30)

Step 3: At B, time = 9:25 AM
  - Unvisited: C
  - Only option: C (12 min from B)
  - Route: [HOME → A → B → C]
  - Time: 10:07 AM (9:25 + 12 + 30)

Final Route: HOME → A → B → C → HOME
Total Time: ~2.5 hours
```

### Phase 3: Swap Improvement

**Function:** `trySwapImprovement(route, distanceMatrix, dependencies, departureTime)`

**Algorithm:** 2-Opt Local Search

```typescript
1. Try swapping every pair of stops
2. For each swap:
   a. Check if dependencies are still satisfied
   b. Calculate new total route time
   c. If new time < old time, keep the swap
3. Repeat until no improvement found
```

**Example Swap:**

```
Original: HOME → A → B → C → HOME
Total: 15 + 10 + 12 + 20 = 57 min

Try swap B and C: HOME → A → C → B → HOME
Total: 15 + 18 + 12 + 25 = 70 min
Result: No improvement, keep original

Try swap A and B: HOME → B → A → C → HOME
Check: Does this violate dependencies?
  - If yes: Skip this swap
  - If no: Calculate total = 25 + 10 + 18 + 20 = 73 min
Result: No improvement, keep original
```

---

## How Tasks Are Chosen and Ordered

### Selection Criteria

**Morning Route (Drop-offs):**
```typescript
// Include:
// 1. All deliveries for the selected date
t.type === 'drop-off' && t.date === selectedDate

// 2. Next-day pickups (equipment left overnight, picked up next morning)
t.type === 'pick-up' &&
t.pickupPreference === 'next_day' &&
t.pickupDate === selectedDate
```

**Afternoon Route (Pickups):**
```typescript
// Include:
// Same-day pickups (delivered in morning, picked up same evening)
t.type === 'pick-up' &&
t.pickupPreference === 'same_day' &&
t.eventDate === selectedDate
```

### Ordering Process

**Step 1: Initial Sort**
Tasks are sorted by their `task_status.sort_order` field:
```typescript
const sorted = tasks.sort((a, b) =>
  (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0)
);
```

**Step 2: Optimization**
When user clicks "Auto-Optimize":
1. Build dependency graph
2. Calculate distances between all stops
3. Find optimal order using greedy + swap algorithm
4. Return tasks in new order

**Step 3: Save**
When user clicks "Save Route":
```typescript
// Update sort_order in database for each task
const updates = optimizedTasks.map((task, index) =>
  supabase
    .from('task_status')
    .update({ sort_order: index })
    .eq('id', task.taskStatus.id)
);
```

---

## Example Walkthrough

Let's walk through a complete real-world example:

### Scenario
You have 6 deliveries scheduled for March 4, 2026:

1. **Octavia Burrage** - 22044 Kessler St, Detroit (Event: 2:00 PM)
2. **Latanya Bellinger** - 5036 S Wayne Rd, Wayne (Event: 11:00 AM)
3. **Richard Hicks** - 28058 Leroy St, Romulus (Event: 12:00 PM)
4. **Steve Hawkins** - 5628 Michael Dr, Ypsilanti (Event: 1:00 PM)
5. **Evan Grayson** - 5529 Pine View Dr, Ypsilanti (Event: 3:00 PM)
6. **LaJuan Ramirez** - 18936 Schoenherr St, Detroit (Event: 4:00 PM)

Home Base: 4426 Woodward St, Wayne, MI

### Step 1: Calculate Distance Matrix

```
           HOME   Octavia Latanya Richard Steve  Evan   LaJuan
HOME       0      35      12      18      25     27     40
Octavia    35     0       40      38      32     30     8
Latanya    12     40      0       10      15     17     42
Richard    18     38      10      0       12     14     35
Steve      25     32      15      12      0      5      28
Evan       27     30      17      14      5      0      25
LaJuan     40     8       42      35      28     25     0
```

### Step 2: Build Dependencies

```typescript
// Check if any stops share equipment
// In this example, assume no shared equipment
dependencies = [];
```

### Step 3: Greedy Route Construction

```
Departure Time: 8:00 AM (earliest event at 11am - 30min buffer - travel time)

Position 1: At HOME (8:00 AM)
  Candidates: All stops
  Nearest: Latanya (12 min)
  Arrive: 8:12 AM
  Ready: 8:42 AM (after 30min setup)

Position 2: At Latanya (8:42 AM)
  Candidates: Octavia, Richard, Steve, Evan, LaJuan
  Nearest: Richard (10 min from Latanya)
  Arrive: 8:52 AM
  Ready: 9:22 AM

Position 3: At Richard (9:22 AM)
  Candidates: Octavia, Steve, Evan, LaJuan
  Nearest: Steve (12 min from Richard)
  Arrive: 9:34 AM
  Ready: 10:04 AM

Position 4: At Steve (10:04 AM)
  Candidates: Octavia, Evan, LaJuan
  Nearest: Evan (5 min from Steve)
  Arrive: 10:09 AM
  Ready: 10:39 AM

Position 5: At Evan (10:39 AM)
  Candidates: Octavia, LaJuan
  Nearest: LaJuan (25 min from Evan)
  Arrive: 11:04 AM
  Ready: 11:34 AM

Position 6: At LaJuan (11:34 AM)
  Candidates: Octavia
  Only option: Octavia (8 min from LaJuan)
  Arrive: 11:42 AM
  Ready: 12:12 PM

Final Optimized Route:
HOME → Latanya → Richard → Steve → Evan → LaJuan → Octavia → HOME

Total Drive Time: 12 + 10 + 12 + 5 + 25 + 8 + 35 = 107 minutes (~1hr 47min)
```

### Step 4: Check Event Times

```
Latanya: Arrive 8:12 AM, Event 11:00 AM ✓ (2hr 48min early)
Richard: Arrive 8:52 AM, Event 12:00 PM ✓ (3hr 8min early)
Steve:   Arrive 9:34 AM, Event 1:00 PM  ✓ (3hr 26min early)
Evan:    Arrive 10:09 AM, Event 3:00 PM ✓ (4hr 51min early)
LaJuan:  Arrive 11:04 AM, Event 4:00 PM ✓ (4hr 56min early)
Octavia: Arrive 11:42 AM, Event 2:00 PM ✓ (2hr 18min early)
```

All deliveries arrive well before event times!

### Step 5: Try Swap Improvements

```
Try swapping each pair and check if total time improves...
(In this case, greedy algorithm already found optimal route)
```

### Step 6: Save to Database

```sql
UPDATE task_status SET sort_order = 0 WHERE id = 'latanya-status-id';
UPDATE task_status SET sort_order = 1 WHERE id = 'richard-status-id';
UPDATE task_status SET sort_order = 2 WHERE id = 'steve-status-id';
UPDATE task_status SET sort_order = 3 WHERE id = 'evan-status-id';
UPDATE task_status SET sort_order = 4 WHERE id = 'lajuan-status-id';
UPDATE task_status SET sort_order = 5 WHERE id = 'octavia-status-id';
```

---

## Key Takeaways

1. **The algorithm prioritizes driving time**, not distance. A longer route in miles might be faster if it avoids traffic or uses highways.

2. **Dependencies are hard constraints**. If Stop B requires equipment from Stop A, B will NEVER come before A, even if it would be faster.

3. **Event times are considered** but not strictly optimized. The algorithm ensures you arrive early enough, but doesn't try to arrive exactly on time.

4. **The greedy algorithm is fast but not perfect**. It finds a good solution quickly (~1-2 seconds) but might not be the absolute best possible route.

5. **Swap improvements help refine the route**. After building the initial greedy route, we try local optimizations to improve it further.

6. **Google Maps provides real-world data**. We use actual traffic patterns and road conditions, not straight-line distances.

---

## Performance Considerations

- **Time Complexity**: O(n²) for distance matrix + O(n²) for greedy + O(n²) for swaps = **O(n²)** overall
- **API Calls**: One batch of Google Distance Matrix calls (typically 1-4 requests for 5-10 stops)
- **Typical Runtime**: 1-3 seconds for 5-10 stops, 5-10 seconds for 20+ stops

---

## Future Improvements

Potential enhancements to the algorithm:

1. **Consider traffic patterns**: Request distances for specific departure times
2. **Multi-vehicle routing**: Optimize routes for multiple trucks simultaneously
3. **Dynamic re-optimization**: Adjust route in real-time as stops are completed
4. **Priority scoring**: Weight stops by customer priority, event size, or other factors
5. **Time windows**: Add "must arrive between X and Y" constraints for some stops


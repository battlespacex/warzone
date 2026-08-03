# StratOps / Warzone Project Rules

## Core Rule

Do not break, remove, redesign, replace, or alter existing working functionality unless the user explicitly requests it.

Make the smallest possible change required to complete the task.

## Before Editing

Before modifying code:

1. Read the request carefully.
2. Inspect the relevant files and functions.
3. Check `git status` and existing uncommitted changes.
4. Identify the root cause.
5. Identify the smallest safe fix.
6. Confirm which files actually need modification.

Do not edit files simply because they are related or nearby.

## Scope Control

Only modify code directly required by the current request.

Do not perform unrelated:

* Refactoring
* Cleanup
* Formatting
* Renaming
* Architecture changes
* Performance changes
* Dependency updates
* File moves
* Code modernization
* Feature redesign
* Removal of apparently unused code

Do not rewrite an entire file when a targeted change is sufficient.

Do not use broad search-and-replace operations without reviewing every affected location.

## Preserve Existing Work

Before editing a file, inspect its current Git diff.

Never overwrite, discard, revert, reset, delete, or replace existing uncommitted work.

Do not run:

* `git reset`
* `git restore`
* `git checkout --`
* `git clean`
* destructive scripts

unless the user explicitly requests it.

Do not commit or push unless explicitly requested.

## Critical High-Risk Areas

Treat these systems as high risk:

* Cesium viewer initialization
* Application boot sequence
* Entry and onboarding screens
* Capabilities and Rules of Engagement screens
* Sign-in and authentication
* Region selection
* Satellite initialization
* Globe camera state
* Entity and layer state
* Loader lifecycle
* Popup and modal mounting
* Global scripts
* Shared event listeners
* API calls
* Supabase initialization
* Routing
* Build configuration
* Webpack configuration
* Shared CSS and root design tokens

Do not modify these systems unless the task explicitly requires it.

## Cesium Lifecycle Protection

The Cesium viewer must initialize only once.

The following screens must use the same continuously running Cesium viewer:

`Entry → Capabilities / Rules of Engagement → Sign-in → Region Selection → Main Interface`

During these transitions:

* Do not reload the page.
* Do not recreate the Cesium viewer.
* Do not destroy the Cesium viewer.
* Do not replace the Cesium container.
* Do not replace a parent containing the Cesium container.
* Do not restart the application boot process.
* Do not reinitialize satellites.
* Do not reset the camera.
* Do not clear entities or layers.
* Do not reload the main interface.
* Do not show the main loader again.

Only modal visibility, overlay states, CSS classes, and onboarding content should change.

## DOM Safety

Do not use broad DOM replacement methods on shared or persistent containers without first inspecting their children.

Be especially careful with:

* `innerHTML`
* `outerHTML`
* `replaceChildren`
* `remove`
* `removeChild`
* template replacement
* container recreation

Never replace an element that contains or controls:

* The Cesium viewer
* Satellites
* Widgets
* Persistent interface elements
* Shared event listeners
* Existing application state

## Initialization Safety

Before adding or changing initialization code, search for existing calls.

Do not create duplicate:

* Viewer initialization
* Satellite initialization
* Hotspot initialization
* Event-marker initialization
* Widget initialization
* Layer initialization
* Authentication initialization
* Event listeners
* Timers
* Animation loops
* Supabase subscriptions

Initialization functions must remain safe and must not run multiple times unintentionally.

## UI Rules

* Do not change styling unless explicitly requested.
* Preserve existing class names.
* Preserve the current layout.
* Preserve current animations and transitions.
* Do not redesign neighbouring components.
* Do not change responsive behaviour unless required.
* Do not replace existing HTML structures without tracing their JavaScript dependencies.

## Performance Rules

Do not add:

* Repeated timers
* Duplicate animation loops
* Duplicate camera listeners
* Duplicate subscriptions
* Expensive work inside render loops
* Repeated Cesium entity recreation
* Repeated API requests

Do not claim a change improves performance unless it was measured or clearly verified.

## Workflow

For every task:

1. Inspect the relevant implementation.
2. Explain the actual root cause.
3. Make the smallest targeted change.
4. Review the complete Git diff.
5. Confirm no unrelated files changed.
6. Run relevant syntax checks.
7. Run the project build.
8. Test the affected user flow.
9. Check nearby functionality for regressions.

## Required Verification

After changes, verify:

* The application loads correctly.
* The Cesium viewer initializes once.
* Satellites initialize once.
* The camera does not reset unexpectedly.
* The loader does not reappear unexpectedly.
* Event listeners are not duplicated.
* API calls are not duplicated.
* Existing layers still work.
* Authentication still works.
* Entry and onboarding transitions remain smooth.
* No unrelated styling changed.
* No unrelated functionality was removed.

For JavaScript changes, run relevant syntax checks.

For project-level changes, run:

```bash
npm run build
```

Only report a test as passed when it was actually run successfully.

## Uncertainty

When uncertain:

1. Perform additional read-only inspection.
2. Trace references and call sites.
3. Review Git history and current diffs.
4. Avoid making speculative changes.

Ask the user only when a required decision cannot be determined safely from the code or request.

Do not make broad changes merely to test a theory.

## Completion Report

At the end of every task, report:

* Root cause
* Exact files changed
* Exact functions changed
* What behaviour changed
* Tests and checks performed
* Build result
* Any remaining risks
* Anything that could not be verified

Never claim that something was fixed, tested, preserved, or verified without evidence.

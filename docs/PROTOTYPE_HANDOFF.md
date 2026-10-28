# Prototype 0.1 — Development handoff

## Milestone

The first playable prototype connects a compact, fixed-isometric 3D farm to a deterministic farming simulation and a persistent village contribution. The browser implementation is the initial technology choice for rapid playtesting; the GDD's full-release scope remains the longer-term reference.

## Implemented acceptance scope

| Area | Implemented behavior |
|---|---|
| Movement | Screen-relative direct controls, collision-aware click paths, cancellation by manual movement |
| Camera | Fixed orthographic angle, bounded zoom, whole-farm framing |
| Farming | 36 plots, four seasonal crops, watering, regrowth, dormant crops, seed recovery |
| Economy | GDD-based provisional seed prices and raw sale prices; immediate sales and staged shipping |
| Progression | First-session guidance, 600-coin row tools, a permanent Welcome Nook contribution |
| Calendar | 28-day seasons, predictable weather, rain watering, Quiet Time, manual sleep |
| Persistence | Versioned local saves, export/import, input validation, recovery copy for malformed saves |
| Presentation | Procedural low-poly art, chibi actors, environmental animation, synthesized interaction audio |
| Comfort | Paused planning panels, reduced ambient motion, sound toggle, relaxed day length, no offline simulation |

## Engineering contracts

- `simulation.ts` owns mutations. Presentation code must not duplicate transaction or growth rules.
- The ending day's season and watered state determine growth before advancing the date.
- A ready crop survives a season transition.
- A shipped item is removed from available inventory until unpacked or paid out.
- A project contribution is consumed once and is never also paid out as a sale.
- Moving cancels pending tool use, and opening a panel pauses the day clock.
- Import validation completes before replacing the active farm.
- No wall-clock timestamp is used to create offline production.
- The development-only browser bridge exposes inspection and deterministic screenshot capture; production builds exclude the bridge.
- Travel consumes elapsed active time across waypoint boundaries and uses collision sub-steps, so low rendering frame rates do not change walking speed.

## Verification snapshot

- TypeScript checks and Vite production build passed.
- 15 simulation, transaction, persistence, and navigation tests passed.
- 6 browser gameplay tests passed: harvest/shipping/sleep/reload; sow/water/grow; purchases/save export; commons contribution; mobile notebook interaction; tall-crop picking.
- Desktop and mobile screenshots were reviewed.
- Browser checks used software WebGL. Hardware performance targets and physical-controller feel remain items for direct playtesting.

## Representative first playtest

1. Start a new farm and close Neri's welcome letter.
2. Click the two ripe Dewturnips. Confirm immediate targeting feedback and successful travel.
3. Sow four prepared patches and water them.
4. Refill the watering can at the well.
5. Ship two crops and inspect tomorrow's quoted payment.
6. Sleep and verify the dawn report against the actual inventory and field.
7. Reload and confirm the same farm returns without extra growth or payment.
8. Visit the seed stall, buy seeds, and compare the displayed cost with the coin change.
9. Gather six Dewturnips or nine Ribbon Beans and develop the Welcome Nook.
10. Compare its visible appearance with the chosen contribution and change its palette.

Record first-harvest time, targeting errors, route failures, requests for help, and the player's next self-selected goal. Physical controller feel and final minimum-spec performance still require direct playtesting.

## Next implementation slice

1. Tune first-session readability, crop selection, and collision based on playtesting.
2. Add compost quality using the existing crop-state and transaction boundaries.
3. Add one functional animal species with shared feeding, a product counter, and safe output storage.
4. Add one processing station with reserved inputs, cancellable pending work, and next-dawn output.
5. Add a complete authored Neri relationship event around the commons contribution.

Before increasing content counts, validate the workload of the current field, the investment pace of row tools, and whether the commons choice is understood as a meaningful contribution.

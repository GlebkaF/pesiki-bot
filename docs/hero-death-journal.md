# Hero death journal (parser v11)

Seven local saved replays were inspected without external game API requests. The prototype observes CDOTA_PlayerResource at every decoded PacketEntities message using the pause-corrected GameRules clock. A bracket is the last observed K/D state and the first changed state. Native float32 timestamp comparisons permit only one float32 ULP at either boundary; no arbitrary second tolerance or 2-second dedup is applied.

| Fixture | Raw real-hero DEATH | Verified deaths | Explicit return + unchanged D | Verified enemy kills |
|---|---:|---:|---:|---:|
| shared 8995355928 | 89 | 87 | 2 | 86 |
| warlock 8995877480 | 61 | 59 | 2 | 58 |
| long 8994151925 | 97 | 93 | 4 | 92 |
| old 8552595443 | 93 | 93 | 0 | 89 |
| second 8996523456 | 80 | 78 | 2 | 77 |
| short 8994933487 | 56 | 56 | 0 | 53 |
| paused 8996432127 | 62 | 61 | 1 | 60 |
| Total | 538 | 527 | 11 | 515 |

All 70 players' final K/D audit matches independently reconstructed events. Final totals are read only after joins and never cause events to be added, removed, or reassigned. Unknown candidates must remain in their counter batch: removing an unknown candidate simply to make the rest fit a delta would create a false killer assignment. Tests explicitly cover this failure mode.

Observed examples:
- Shared: Kunkka's one +2 kill update includes two distinct, independently death-verified victims, Pudge and Undying. Whole-batch cardinality and identity/team evidence confirm both pairs.
- Shared: Undying zombie killed Phantom Assassin; explicit DamageSourceName is Undying and Undying's K counter independently increments.
- Long: two Axe deaths have raw Clinkz skeleton archer attacker, explicit Clinkz owner and verified Clinkz K deltas.
- Old: Techies mines; second and short: Invoker forged spirits, verified by the same explicit-source/counter method.
- Paused: Treant killed allied Earthshaker at native 1422.1333. Earthshaker D increases, Treant K does not; both team2. This is an allied deny, excluded from enemy-kill matrix.
- The other 11 non-hero-credit deaths have explicit tower, neutral or fountain attackers. No missing hero owner is fabricated.

The WillReincarnate flag accounts for all 11 excess DEATH rows in these fixtures. It does not establish whether the return comes from Aegis, a hero ability, or another mechanism. AEGIS_TAKEN events are absent from these fixtures. The single modifier_aegis_regen observation in long is not proof that any particular DEATH consumed Aegis. UI should say return/reincarnation, never unconditionally Aegis.

Arc Warden is present in second. Its six logged real-hero deaths equal its actual D counter; widening the prototype filter to all is_target_hero and all arc_warden names found no extra clone death rows in this fixture. This is not a general guarantee about clone logging. Production journal gates every matrix entry on independent counters, so an uncounted clone death cannot become a verified death just because the target string resembles a hero. Explicit target illusions are excluded.

Native D-update brackets are normally <=0.0669s; old replay contains an observed ~0.10005s bracket. Event-to-update delay is at most about 0.0336s in these fixtures. A pause may produce a legitimate zero-width native-time counter bracket; it is supported, rather than mistaken for a counter reset. Missing native clock, counter regression, identity conflict, truncation, duplicate or unexplained batch yields unverified evidence. Postgame cleanup is excluded at the first observed game-state6.

Implementation: new tools/replay-parser/hero_death_journal.go and hero_death_journal_test.go; minimal main.go constructor/output/version integration. Additive v11 leaves all v10 payload fields byte-for-value identical, including all451 ward lifetimes across the seven fixtures, except pre-existing unrelated nondeterministic top_spells cutoff ties.

## Storage and presentation

`hero_death_journal` is additive. Storage validates its contract before replacing retained observations; thin refreshes preserve it and older parser versions cannot downgrade it. `hero-death-journal.ts` derives only independently verified enemy pairs. Incomplete coverage displays confirmed minima and unknown empty cells, not invented zeroes. Official scoreboard KDA remains separately sourced. Coordinates are reused only for mutually unique victim/time matches with existing positioned combat events. Reincarnation events never link to a normal death recap.

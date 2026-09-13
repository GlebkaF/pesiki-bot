# Map calibration research — 2026-09-13

The current release intentionally uses a coordinate diagram, not terrain or fog of war. Episode maps use fixed world bounds −10000…+10000 on both axes. Do not autoscale based on selected events: changing a filter must not move a stationary point.

## Sources inspected

- [OpenDota DotaMap](https://github.com/odota/web/blob/master/src/components/DotaMap/DotaMap.tsx) selects terrain images by patch date, with versions 7.40, 7.38, 7.33 and earlier. Its latest available map is not evidence of the patch of our match.
- [Pinned 7.40 map asset](https://github.com/odota/web/blob/301db7412410550476bc70e983fd91668a6b8e85/public/assets/images/dota2/map/detailed_740.webp), committed 2026-01-20; 900×900, visually inspected. The asset has terrain, river, ramps and trees. The image is not copied into this project.
- [OpenDota TeamfightMap](https://github.com/odota/web/blob/master/src/components/Match/TeamfightMap/TeamfightMap.tsx) renders normalized positions using width/127. Those values cannot be mixed directly with our world coordinates.
- [OpenDota parser](https://github.com/odota/parser/blob/master/src/main/java/opendota/Parse.java) reads cell and vector components; `getPreciseLocation` returns `(cell*128 + vec)/128`. The subsequent complete normalization pipeline still needs verification before reuse.
- [Dotabuff death and vision maps](https://www.dotabuff.com/blog/2015-07-29-truesight-interactive-death-and-vision-maps): official historical example of time filtering and per-marker details. Ward lifetime requires placement and removal evidence, not purchase timestamps.
- [Dotabuff Combat Tab](https://www.dotabuff.com/blog/2016-05-04-the-combat-tab): official historical example of damage/healing/CC breakdowns and per-cast drilldown. Our saved events do not yet establish equivalent per-cast effectiveness or CC coverage.
- [Valve patch 7.40](https://www.dota2.com/patches/7.40): official patch entry, but page text was unavailable to the research tool. It does not establish compatibility with September 2026 matches.

## Terrain release gate

1. Establish match map/build/patch identity from replay or reliable metadata. Never default an unknown match to the newest asset.
2. Pin the chosen asset and document its provenance and distribution terms.
3. Derive world-coordinate bounds, axis direction and crop transform from the same map version. Keep these fixed across filters and time.
4. Validate at least three non-collinear landmarks against the image: both Ancients and another known structure near the centre. Use entity positions, not guessed coordinates from screenshots. Check corners and map edges too.
5. Store the transform and supported patch range as explicit versioned metadata. Fail back to the labelled coordinate diagram outside that range.
6. Reject or separately count out-of-bounds events; do not silently clamp them to an invented location on the map edge.

For a calibrated rectangular crop, the candidate transform is `pixelX=(worldX-xMin)/(xMax-xMin)*width`, `pixelY=(yMax-worldY)/(yMax-yMin)*height`. Values for terrain bounds are intentionally not asserted here.

## Episode UX

Show both teams' death counts, exact event times, and observed heroes. A full roster is not proof of participation in a fight. The default journal contains deaths, buybacks and key casts; ordinary casts can be expanded. Events close in time may occur in different locations. Nearby objectives and minute-level economy belong in a separate context panel and must not be presented as the causal outcome of a fight.

Mobile map markers use tap plus keyboard activation and a persistent textual selection below the map. Keep the full event list available when coordinates are absent. Colour must be accompanied by team/type text. Terrain does not establish line of sight, ward coverage or whether an enemy was visible.

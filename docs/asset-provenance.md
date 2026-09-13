# Game asset provenance

## Valve Dota minimap — extracted 2026-09-13

Asset: `src/web/assets/dota-741-minimap.png` (512 × 512 RGBA PNG, 500,436 bytes).

This is the actual minimap texture from the locally installed Valve Dota 2 client, not a generated terrain image or a renamed 7.40 community map. The installation reports:

- Steam app 570, installed build **25132749**.
- `game/dota/steam.inf`: ClientVersion/ServerVersion **6924**, SourceRevision **10969619**, VersionDate **Sep 04 2026**, VersionTime **14:21:17**.
- Source archive: `game/dota/pak01_dir.vpk` and the data archive referenced by its directory entry.
- Material chain: `resource/overviews/dota.txt` → `materials/overviews/dota.vmat_c` → RERL dependency `materials/overviews/dota_tga_d8178876.vtex` (compiled `.vtex_c`).
- Texture resource: header version 12, resource version 1; DATA block offset 1008, length 1076; VTEX version 1; width/height 512, depth 1, format **4 / RGBA8888**, one mip. Pixel payload starts at byte 2084 and contains exactly 1,048,576 bytes.

The VPK directory and texture header were read with a small task-specific Python script. The unmodified RGBA payload was losslessly encoded as PNG using Python's `struct`/`zlib`, adaptive PNG row filters and zlib level 9. An independent inverse-filter pass confirmed all 1,048,576 decoded RGBA bytes remained identical. No downloaded repository scripts or game executable were run. Format interpretation was checked against [ValveResourceFormat's Texture reader](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/Texture.cs) and [VTexFormat enum](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/Enums/VTexFormat.cs).

### Checksums (SHA-256)

| File | SHA-256 |
|---|---|
| `resource/overviews/dota.txt` | `fc31a7979950863f262afd2f0c8d7a8bf5ec6ffbdc48c465aa5495cd41d4cc1d` |
| `materials/overviews/dota.vmat_c` | `ad739758ebb3500ade16b19e8cf20902833525cda9a4b36e8b96d33535d9387d` |
| `materials/overviews/dota_tga_d8178876.vtex_c` | `1ea55acc8b50b26a9a6e456b8746101c994f4c6b664b40c2385f4fc51cc58f2c` |
| Exported PNG | `6fa2c35cde372d111d8e0bd1aff66825dd36f77c14ac487e4e584e17beb1fddf` |

### Coordinate evidence and version limits

The same installed archive's `resource/overviews/dota.txt` contains:

```text
dota
{
    material materials/overviews/dota.vmat
    simple_material materials/overviews/dota_minimal.vmat
    pos_x -9472
    pos_y 9472
    scale 18.500
}
```

The candidate world rectangle is **x −9472…9472, y −9472…9472**, using the overview's 1024-unit reference image width (`18.5 × 1024 = 18944`). For the exported 512px image:

```text
pixelX = (worldX + 9472) / 18944 × 512
pixelY = (9472 - worldY) / 18944 × 512
```

Y increases upward in world space and downward in the PNG. This rectangle belongs to the Valve minimap. Do not apply Spectral's stitched-map bounds to it. Out-of-bounds events must not be silently clamped.

Independent real replay entity landmarks were extracted for match 8994151925, using `cell × 128 + vector − 16384`. They provide calibration checks, not coordinates guessed from artwork:

| Landmark | World x | World y | Candidate PNG x | Candidate PNG y |
|---|---:|---:|---:|---:|
| Radiant Ancient | −5920 | −5352 | 96.00 | 400.65 |
| Dire Ancient | 5528 | 5000 | 405.41 | 120.86 |
| Radiant middle T1 | −1544 | −1408 | 214.27 | 294.05 |
| Dire middle T1 | 524 | 652 | 270.16 | 238.38 |

The replay header identifies a later `dota_v6930` game directory. Thus the PNG is pinned to **installed client 6924**, not asserted to be byte-identical to every later game client. The site's separately saved official API patch identity for the current matches is 7.41; the filename expresses that patch-family target, not an exact per-match build extraction. Landmark overlay validation and an explicit supported-patch gate remain necessary before displaying match markers on terrain. This texture has been visually inspected and contains contemporary river, ramp, tree, base, and pit geometry; it is minimap artwork, not a photograph and not visibility/fog-of-war evidence.

The image is Valve game artwork; retain Valve attribution. This document records provenance and does not assign a new open-source license to Valve artwork.

### Other sources inspected

- [Spectral / leamare interactive map](https://github.com/leamare/dota-interactive-map): commit `bc73d0e3ea` explicitly updates to 7.41 (2026-04-03). Its repository includes 7.41 navigation/elevation data and a packed diagnostic raster; its terrain tiles are hosted separately and returned Cloudflare 403 during this task. Its independent stitched-map bounds are not applicable to the Valve texture.
- OpenDota's retained `detailed_740.webp` is explicitly 7.40 and was **not** renamed or used as the 7.41 asset.

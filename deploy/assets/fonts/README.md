# Self-hosted fonts

Variable woff2 subsets taken unmodified from the `@fontsource-variable/*` 5.3.0
packages (npm), which repackage the upstream releases of each family:

| File | Family | Upstream | Licence |
|---|---|---|---|
| `vazirmatn-5.3.0-{arabic,latin}.woff2` | Vazirmatn | rastikerdar/vazirmatn | SIL OFL 1.1 (`LICENSE-vazirmatn.txt`) |
| `markazi-text-5.3.0-{arabic,latin}.woff2` | Markazi Text | Google Fonts | SIL OFL 1.1 (`LICENSE-markazi-text.txt`) |
| `fraunces-5.3.0-latin.woff2` | Fraunces (opsz + wght axes) | undercasetype/Fraunces | SIL OFL 1.1 (`LICENSE-fraunces.txt`) |

The version is part of each filename so the files can be served `immutable`.
To update a font, add a new file with the new version in its name and point
`@font-face` in `../chaacme.css` at it.

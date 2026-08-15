# Optimize Images Action

A fast GitHub Action powered by **[Bun](https://bun.sh)** and native **`Bun.Image`** processing pipeline to automatically optimize JPEG, PNG, and WebP images in your GitHub repository.

## Features

- **Blazing Fast**: Powered by Bun's native image transformation pipeline (zero heavy C++ native module npm installs).
- **Supports Popular Formats**: Optimizes `.jpg`, `.jpeg`, `.png`, and `.webp` images.
- **Optional WebP Conversion**: Optionally converts JPEG/PNG images to modern WebP format when byte savings are realized.
- **Configurable**: Customize compression levels, target folders, and ignored patterns.
- **Detailed Output**: Provides clear logs and GitHub Action output variables for summary reports and downstream steps.

---

## Usage

Add a workflow file (e.g. `.github/workflows/optimize-images.yml`) to your repository:

### Basic Example (Automated PR / Push Optimization)

```yaml
name: Optimize Images

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  optimize:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Optimize Images
        uses: ./
        with:
          jpeg_quality: "80"
          png_compression_level: "6"
          webp_quality: "80"

      - name: Commit optimized images
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: optimize images [skip ci]"
```

---

## Inputs

| Input                   | Description                                                                              | Default                        |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| `path`                  | Target directory or path pattern to search for images.                                   | `.`                            |
| `ignore_paths`          | Comma-separated list of relative directory/file paths to ignore.                         | `node_modules,.git,dist,build` |
| `jpeg_quality`          | Compression quality for JPEG images (`1`-`100`).                                         | `80`                           |
| `png_compression_level` | Compression level for PNG images (`0`-`9`).                                              | `6`                            |
| `webp_quality`          | Compression quality for WebP images (`1`-`100`).                                         | `80`                           |
| `convert_to_webp`       | Automatically convert JPEG/PNG images to WebP format if size decreases (`true`/`false`). | `false`                        |

---

## Outputs

| Output                  | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `total_original_bytes`  | Total byte size of all discovered target images before optimization. |
| `total_optimized_bytes` | Total byte size of images after optimization.                        |
| `total_saved_bytes`     | Total bytes saved across all optimized images.                       |
| `optimized_count`       | Number of images successfully optimized or converted.                |

---

## Local Development & Testing

Run tests locally using Bun:

```bash
bun test
```

Run the optimizer on local images:

```bash
INPUT_PATH="./images" bun run src/index.ts
```

## License

[MIT](LICENSE)

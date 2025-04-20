# Sitemap Crawler

A command-line tool to extract content from sitemap URLs and save as markdown files.

## Features

- Extract URLs from a sitemap
- Process each URL with Mozilla's Readability to extract main content
- Convert content to markdown using Turndown
- Save each page as a markdown file in a specified output directory

## Installation

```bash
# Install globally from npm
npm install -g @mkusaka/sitemap-crawler

# Or use with npx
npx @mkusaka/sitemap-crawler <command>

# Alternatively, clone the repository
git clone https://github.com/mkusaka/sitemap-crawler.git
cd sitemap-crawler

# Install dependencies
pnpm install

# Build the project
pnpm run build
```

## Usage

```bash
# Basic usage
@mkusaka/sitemap-crawler crawl <sitemap-url> <output-directory>

# Example
@mkusaka/sitemap-crawler crawl https://example.com/sitemap.xml ./output

# With options
@mkusaka/sitemap-crawler crawl https://example.com/sitemap.xml ./output --continue --rate-limit 2
```

### Options

- `--debug`: Enable debug mode
- `--continue`: Continue processing even if a URL fails
- `-r, --retries <number>`: Number of retry attempts for failed URLs (default: 3)
- `-d, --retry-delay <number>`: Initial delay between retries in milliseconds (default: 1000)
- `-l, --rate-limit <number>`: Maximum number of requests per second (default: 1, 0 to disable)

## Output Format

Each URL is processed and saved as a markdown file with YAML frontmatter containing metadata:

```markdown
---
title: Page Title
url: https://example.com/page
siteName: Example Site
excerpt: A brief excerpt from the page
wordCount: 1234
---

# Page Title

Content converted to markdown...
```

## License

MIT

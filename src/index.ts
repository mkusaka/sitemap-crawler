#!/usr/bin/env node

import { Command } from "commander";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import Sitemapper from "sitemapper";
import TurndownService from "turndown";
import pRetry from "p-retry";
import pThrottle from "p-throttle";
import { dump as yamlDump } from "js-yaml";

const turndownService = new TurndownService();

interface CrawlOptions {
  output?: string;
  debug?: boolean;
  continue?: boolean;
  retries?: string;
  retryDelay?: string;
  rateLimit?: string;
}

function urlToFilename(url: string): string {
  const urlObj = new URL(url);
  let filename = urlObj.pathname.replace(/^\//, "").replace(/\//g, "-");
  if (!filename) filename = "index";
  if (!filename.endsWith(".md")) filename += ".md";
  return filename;
}

const program = new Command();

program
  .name("sitemap-crawler")
  .description("Extract content from sitemap URLs and save as markdown files")
  .version("1.0.0");

program
  .command("crawl")
  .description(
    "Extract content from URLs in a sitemap and save as markdown files"
  )
  .argument("<url>", "Sitemap URL to fetch URLs from")
  .argument("<output-dir>", "Directory to save extracted markdown files")
  .option("--debug", "Enable debug mode")
  .option("--continue", "Continue processing even if an URL fails")
  .option(
    "-r, --retries <number>",
    "Number of retry attempts for failed URLs",
    "3"
  )
  .option(
    "-d, --retry-delay <number>",
    "Initial delay between retries in milliseconds",
    "1000"
  )
  .option(
    "-l, --rate-limit <number>",
    "Maximum number of requests per second (0 to disable)",
    "1"
  )
  .action(async (url: string, outputDir: string, options: CrawlOptions) => {
    try {
      if (options.debug) {
        console.log(chalk.blue("Debug mode enabled"));
        console.log(chalk.blue(`Fetching sitemap from: ${url}`));
      }

      const sitemap = new (Sitemapper as any)({ timeout: 15000 });

      try {
        const outputPath = resolve(process.cwd(), outputDir);
        await mkdir(outputPath, { recursive: true });

        const { sites } = await sitemap.fetch(url);
        console.log(chalk.green(`Found ${sites.length} URLs in sitemap`));

        const rateLimitPerSecond = parseInt(options.rateLimit || "1");
        console.log(
          chalk.blue(
            `Rate limit set to ${rateLimitPerSecond} requests per second${
              rateLimitPerSecond === 0 ? " (disabled)" : ""
            }`
          )
        );

        const throttle =
          rateLimitPerSecond > 0
            ? pThrottle({
                limit: rateLimitPerSecond,
                interval: 1000,
              })
            : (fn: Function) => fn;

        const results = await Promise.allSettled(
          sites.map(async (siteUrl: string, i: number) => {
            console.log(
              chalk.blue(`Processing ${i + 1}/${sites.length}: ${siteUrl}`)
            );

            try {
              return await throttle(async () => {
                return await pRetry(
                  async () => {
                    console.log(chalk.blue(`Fetching URL: ${siteUrl}`));
                    
                    const dom = await JSDOM.fromURL(siteUrl);
                    const reader = new Readability(dom.window.document);
                    const article = reader.parse();
                    
                    if (!article) {
                      console.log(chalk.yellow(`No content found for ${siteUrl}`));
                      throw new Error("No content found");
                    }
                    
                    const markdown = turndownService.turndown(article.content || "");
                    
                    const metadata = {
                      title: article.title,
                      excerpt: article.excerpt,
                      siteName: article.siteName,
                      url: siteUrl,
                      wordCount: article.textContent ? article.textContent.split(/\s+/).length : 0,
                      length: article.length,
                      processedAt: new Date().toISOString(),
                    };
                    
                    const yamlFrontmatter = yamlDump(metadata);
                    const content = `---
${yamlFrontmatter}---

# ${metadata.title || "Untitled"}

${markdown}
`;

                    const filename = urlToFilename(siteUrl);
                    const filePath = resolve(outputPath, filename);
                    
                    await writeFile(filePath, content, "utf-8");
                    console.log(chalk.green(`Saved to ${filePath}`));
                    
                    return { success: true, url: siteUrl, path: filePath };
                  },
                  {
                    retries: parseInt(options.retries || "3"),
                    factor: 2, // Exponential factor (2 means delay doubles each time)
                    minTimeout: parseInt(options.retryDelay || "1000"), // Initial delay
                    maxTimeout: 60000, // Maximum delay of 60 seconds
                    onFailedAttempt: (error) => {
                      const retryCount = error.attemptNumber;
                      const maxRetries = parseInt(options.retries || "3");
                      const nextRetryDelay = Math.min(
                        parseInt(options.retryDelay || "1000") *
                          Math.pow(2, retryCount - 1),
                        60000
                      );
                      console.log(
                        chalk.yellow(
                          `Attempt ${retryCount}/${maxRetries} failed for ${siteUrl}: ${error.message}`
                        )
                      );
                      console.log(
                        chalk.yellow(
                          `Next retry in ${nextRetryDelay}ms with exponential backoff`
                        )
                      );
                    },
                  }
                );
              });
            } catch (error) {
              console.error(
                chalk.red(`Error processing ${siteUrl} after all retry attempts:`),
                error instanceof Error ? error.message : "Unknown error occurred"
              );
              
              if (!options.continue) {
                console.error(
                  chalk.red(
                    "Stopping due to error. Use --continue to process despite errors."
                  )
                );
                process.exit(1);
              }
              
              return { success: false, url: siteUrl, error };
            }
          })
        );

        const successful = results.filter(
          (result) => result.status === "fulfilled"
        ).length;
        const failed = results.filter(
          (result) => result.status === "rejected"
        ).length;

        console.log(
          chalk.green(
            `Completed processing ${sites.length} URLs from sitemap: ${successful} successful, ${failed} failed`
          )
        );
        process.exit(0);
      } catch (error) {
        console.error(
          chalk.red("Error fetching sitemap:"),
          error instanceof Error ? error.message : "Unknown error occurred"
        );
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error occurred"
      );
      process.exit(1);
    }
  });

program.parse();

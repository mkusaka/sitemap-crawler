#!/usr/bin/env node

import { Command } from "commander";
import { JSDOM } from "jsdom";
import Parser from "@postlight/parser";
import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import Sitemapper from "sitemapper";
import pRetry from "p-retry";
import pThrottle from "p-throttle";
import { dump as yamlDump } from "js-yaml";
import crypto from "crypto";

interface CrawlOptions {
  output?: string;
  debug?: boolean;
  continue?: boolean;
  retries?: string;
  retryDelay?: string;
  rateLimit?: string;
}

function urlToFilename(url: string): string {
  const md5Hash = crypto.createHash("md5").update(url).digest("hex");
  return `${md5Hash}.md`;
}

const program = new Command();

program
  .name("@mkusaka/sitemap-crawler")
  .description("Extract content from sitemap URLs and save as markdown files")
  .version("0.0.1");

program
  .command("crawl")
  .description(
    "Extract content from URLs in a sitemap and save as markdown files",
  )
  .argument("<url>", "Sitemap URL to fetch URLs from")
  .argument("<output-dir>", "Directory to save extracted markdown files")
  .option("--debug", "Enable debug mode")
  .option("--continue", "Continue processing even if an URL fails")
  .option(
    "-r, --retries <number>",
    "Number of retry attempts for failed URLs",
    "3",
  )
  .option(
    "-d, --retry-delay <number>",
    "Initial delay between retries in milliseconds",
    "1000",
  )
  .option(
    "-l, --rate-limit <number>",
    "Maximum number of requests per second (0 to disable)",
    "1",
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
            }`,
          ),
        );

        // URL処理関数を定義
        const processUrl = async (siteUrl: string) => {
          console.log(chalk.blue(`Fetching URL: ${siteUrl}`));

          const result = await Parser.parse(siteUrl, {
            contentType: "markdown",
          });

          if (!result || !result.content) {
            console.log(chalk.yellow(`No content found for ${siteUrl}`));
            throw new Error("No content found");
          }

          const markdown = result.content;

          const metadata = {
            title: result.title,
            excerpt: result.excerpt,
            siteName: result.domain,
            url: siteUrl,
            wordCount: result.word_count,
            length: result.word_count, // Using word_count instead of article.length from Readability
            processedAt: new Date().toISOString(),
            author: result.author,
            date_published: result.date_published,
            lead_image_url: result.lead_image_url,
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
        };

        // リトライ設定
        const retryOptions = {
          retries: parseInt(options.retries || "3"),
          factor: 2, // Exponential factor (2 means delay doubles each time)
          minTimeout: parseInt(options.retryDelay || "1000"), // Initial delay
          maxTimeout: 60000, // Maximum delay of 60 seconds
          onFailedAttempt: (error: any) => {
            const retryCount = error.attemptNumber;
            const maxRetries = parseInt(options.retries || "3");
            const nextRetryDelay = Math.min(
              parseInt(options.retryDelay || "1000") *
                Math.pow(2, retryCount - 1),
              60000,
            );
            console.log(
              chalk.yellow(
                `Attempt ${retryCount}/${maxRetries} failed for ${error.options?.url || "unknown URL"}: ${error.message}`,
              ),
            );
            console.log(
              chalk.yellow(
                `Next retry in ${nextRetryDelay}ms with exponential backoff`,
              ),
            );
          },
        };

        // スロットリング関数を作成
        const throttledFn =
          rateLimitPerSecond > 0
            ? pThrottle({
                limit: rateLimitPerSecond,
                interval: 1000,
              })(async (siteUrl: string) => {
                return await pRetry(() => processUrl(siteUrl), retryOptions);
              })
            : async (siteUrl: string) => {
                return await pRetry(() => processUrl(siteUrl), retryOptions);
              };

        const results = await Promise.allSettled(
          sites.map(async (siteUrl: string, i: number) => {
            console.log(
              chalk.blue(`Processing ${i + 1}/${sites.length}: ${siteUrl}`),
            );

            try {
              return await throttledFn(siteUrl);
            } catch (error) {
              console.error(
                chalk.red(
                  `Error processing ${siteUrl} after all retry attempts:`,
                ),
                error instanceof Error
                  ? error.message
                  : "Unknown error occurred",
              );

              if (!options.continue) {
                console.error(
                  chalk.red(
                    "Stopping due to error. Use --continue to process despite errors.",
                  ),
                );
                process.exit(1);
              }

              return { success: false, url: siteUrl, error };
            }
          }),
        );

        const successful = results.filter(
          (result) => result.status === "fulfilled",
        ).length;
        const failed = results.filter(
          (result) => result.status === "rejected",
        ).length;

        console.log(
          chalk.green(
            `Completed processing ${sites.length} URLs from sitemap: ${successful} successful, ${failed} failed`,
          ),
        );
        process.exit(0);
      } catch (error) {
        console.error(
          chalk.red("Error fetching sitemap:"),
          error instanceof Error ? error.message : "Unknown error occurred",
        );
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error occurred",
      );
      process.exit(1);
    }
  });

program.parse();

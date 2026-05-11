import { chromium } from "playwright";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";

const season = process.argv[2];
const homeUrl = "https://south-park-tv.fr/";
const seasonUrlPattern = `${homeUrl}${season}-`;
const episodeUrlPattern = /episode-(\d+)/;
const urlPattern = /(\d+).mp4/;

const browser = await chromium.launch({
	executablePath: "/run/current-system/sw/bin/chromium",
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	proxy: { server: "socks5://127.0.0.1:9050" },
	args: ["--disable-blink-features=automationcontrolled"],
	timeout: 60000, // 60 seconds instead of default 30
});

const directBrowser = await chromium.launch({
	executablePath: "/run/current-system/sw/bin/chromium",
	userAgent:
		"mozilla/5.0 (x11; linux x86_64; rv:149.0) gecko/20100101 firefox/149.0",
	// proxy: {
	// 	server: "http://88.1.150.79:3128",
	// },
	args: ["--disable-blink-features=automationcontrolled"], // hides automation flag
	timeout: 60000, // 60 seconds instead of default 30
});

const page = await browser.newPage();
const directPage = await directBrowser.newPage();

await page.route("**/*", (route) => {
	const type = route.request().resourceType();
	if (["image", "stylesheet", "font", "media"].includes(type)) {
		route.abort();
	} else {
		route.continue();
	}
});

await directPage.route("**/*", (route) => {
	const type = route.request().resourceType();
	if (["image", "stylesheet", "font"].includes(type)) {
		route.abort();
	} else {
		route.continue();
	}
});

const videosUrls = [];
directPage.on("request", (request) => {
	const url = request.url();
	if (
		url.includes(".mp4") &&
		url.includes("st=") &&
		url.includes("stor=") &&
		url.includes("noip=")
	) {
		const matched = url.match(urlPattern);
		if (!matched) {
			return null;
		}
		const [_, episodeName] = matched;
		if (videosUrls.some((video) => video.url.includes(episodeName))) {
			return;
		}
		videosUrls.push({
			name: formatName(videosUrls.length + 1),
			url,
		});
	}
});

await page.goto(homeUrl, { waitUntil: "load" });

await wait(4000);
const seasonUrl = await getSeasonPage();

if (!seasonUrl) {
	console.log("No page found for ", season);
	process.exit(1);
}

await page.goto(seasonUrl, { waitUntil: "load" });
await wait(2000);

const episodeLinks = await getEpisodeLinks(seasonUrl);

for (const url of episodeLinks) {
	try {
		await triggerPlayVideo(url);
	} catch (err) {
		console.error(err);
	}
}

await wait(2000);

const videosPath = path.join(os.homedir(), "Videos", "south_park", season);

fs.mkdirSync(videosPath, { recursive: true });

console.log(" videosUrls", videosUrls);
for (const { name, url } of videosUrls) {
	if (["1.mp4", "2.mp4"].includes(name)) {
		continue;
	}
	await downloadVideo(url, `${videosPath}/${name}`);
}

async function downloadVideo(url, outputPath) {
	const response = await fetch(url);

	if (!response.ok) throw new Error(`HTTP ${response.status}`);

	const total = parseInt(response.headers.get("content-length"), 10);
	let downloaded = 0;

	const progressStream = new TransformStream({
		transform(chunk, controller) {
			downloaded += chunk.length;
			const percent = ((downloaded / total) * 100).toFixed(1);
			process.stdout.write(`\rDownloading... ${percent}%`);
			controller.enqueue(chunk);
		},
	});

	await pipeline(
		Readable.fromWeb(response.body.pipeThrough(progressStream)),
		fs.createWriteStream(outputPath),
	);

	console.log("\nDone!");
}

async function triggerPlayVideo(url) {
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
	await wait(4000);
	try {
		const frameElement = await page.waitForSelector(
			'iframe[src*="https://video.sibnet.ru"]',
		);
		const frameSrc = await frameElement.getAttribute("src");

		await directPage.goto(frameSrc, {
			waitUntil: "domcontentloaded",
			timeout: 120000,
		});
		await wait(2000);
		await directPage.evaluate(() => {
			document
				.querySelector('.vjs-big-play-button[aria-label="play video"]')
				.click();
		});

		return frameSrc;
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function getSeasonPage() {
	const pattern = `a[href*="${seasonUrlPattern}"]`;
	const links = await page.$$eval(pattern, (links) => links.map((l) => l.href));

	return links[0];
}

async function getEpisodeLinks(url) {
	const pattern = `a[href*="${url}"]`;
	const links = await page.$$eval(pattern, (links) => links.map((l) => l.href));

	return [...new Set(links)]
		.map((url) => {
			const matched = url.match(episodeUrlPattern);
			if (!matched) {
				return null;
			}
			return url;
		})
		.filter((formatted) => formatted)
		.sort();
}

function wait(time) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, time);
	});
}

function formatName(number) {
	const str = `${number}.mp4`;
	return str.length > 1 ? str : `0${str}`;
}

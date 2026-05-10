import { chromium } from "playwright";

const season = process.argv[2];
const homeUrl = "https://south-park-tv.fr/";
const seasonUrlPattern = `${homeUrl}${season}-`;
const episodeUrlPattern = /episode-(\d+)/;

const browser = await chromium.launch({
	executablePath: "/run/current-system/sw/bin/chromium",
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	proxy: { server: "socks5://127.0.0.1:9050" },
	args: ["--disable-blink-features=automationcontrolled"], // hides automation flag
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
		videosUrls.push(url);
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

const videoInfos = [];
for (const { name, url } of episodeLinks) {
	try {
		const videoUrl = await downloadEpisode(url);
		if (videoUrl) {
			videoInfos.push({
				name,
				videoUrl,
			});
		}
	} catch (err) {
		console.error(err);
	}
}

const finalData = mapVideoUrls(videoInfos, videosUrls);

function mapVideoUrls(infos, urls) {
	return infos.map(({ name, videoUrl }) => {
		const finalUrl = urls.find((url) => url.includes(videoUrl));
		return {
			name,
			videoUrl: finalUrl,
		};
	});
}

async function downloadEpisode(url) {
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

		// .vjs-big-play-button[role="button"]
		// const btn = await directPage.getByLabel("play video");
		// await btn.scrollIntoViewIfNeeded();
		// await btn.click({ force: true });
		await directPage.evaluate(() => {
			document
				.querySelector('.vjs-big-play-button[aria-label="play video"]')
				.click();
		});

		console.log("clicked play button successfully");
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
			const [_, name] = matched;
			return {
				name,
				url,
			};
		})
		.filter((formatted) => formatted);
}

function wait(time) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, time);
	});
}

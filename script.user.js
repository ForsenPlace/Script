// ==UserScript==
// @name         ForsenPlace Script
// @namespace    https://github.com/ForsenPlace/Script
// @version      7
// @description  Script 
// @author       ForsenPlace
// @match        https://www.reddit.com/r/place/*
// @match        https://new.reddit.com/r/place/*
// @icon         https://cdn.frankerfacez.com/emoticon/545961/4
// @require	     https://cdn.jsdelivr.net/npm/toastify-js
// @resource     TOASTIFY_CSS https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css
// @updateURL    https://github.com/ForsenPlace/Script/raw/main/script.user.js
// @downloadURL  https://github.com/ForsenPlace/Script/main/script.user.js
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==

const ORDERS_URL = 'https://raw.githubusercontent.com/ForsenPlace/Orders/main/orders.json'

const ORDER_UPDATE_DELAY = 5 * 60 * 1000
const TOAST_DURATION = 10000
const MAP_ERROR_RETRY_DELAY = 15000
const PARSE_ERROR_RETRY_DELAY = 15000
const AFTER_PAINT_DELAY = 315000
const CHECK_AGAIN_DELAY = 30000

const COLOR_TO_INDEX = {
	'#FF4500': 2,
	'#FFA800': 3,
	'#FFD635': 4,
	'#00A368': 6,
	'#7EED56': 8,
	'#2450A4': 12,
	'#3690EA': 13,
	'#51E9F4': 14,
	'#811E9F': 18,
	'#B44AC0': 19,
	'#FF99AA': 23,
	'#9C6926': 25,
	'#000000': 27,
	'#898D90': 29,
	'#D4D7D9': 30,
	'#FFFFFF': 31
};
const INDEX_TO_NAME = {
	'2': 'red',
	'3': 'orange',
	'4': 'yellow',
	'6': 'dark green',
	'8': 'light green',
	'12': 'dark blue',
	'13': 'blue',
	'14': 'light blue',
	'18': 'dark purple',
	'19': 'purple',
	'23': 'light pink',
	'25': 'brown', 
	'27': 'black',
	'29': 'gray',
	'30': 'light gray',
	'31': 'white'
};

var currentOrdersByPrio = [];
var accessToken;
var canvas = document.createElement('canvas');

(async function () {
	GM_addStyle(GM_getResourceText('TOASTIFY_CSS'));
	canvas.width = 1000;
	canvas.height = 1000;
	canvas = document.body.appendChild(canvas);

	Toastify({
		text: 'Obtaining access token...',
		duration: TOAST_DURATION
	}).showToast();
	accessToken = await getAccessToken();
	Toastify({
		text: 'Obtained access token!',
		duration: TOAST_DURATION
	}).showToast();

	setInterval(updateOrders, ORDER_UPDATE_DELAY);
	await updateOrders();
	executeOrders();
})();

async function getAccessToken() {
	const usingOldReddit = window.location.href.includes('new.reddit.com');
    const url = usingOldReddit ? 'https://new.reddit.com/r/place/' : 'https://www.reddit.com/r/place/';
    const response = await fetch(url);
    const responseText = await response.text();

	return responseText.split('\"accessToken\":\"')[1].split('"')[0];
}

function updateOrders() {
	fetch(ORDERS_URL).then(async (response) => {
		if (!response.ok) return console.warn('Couldn\'t get orders (error response code)');
		const newOrders = await response.json();

		if (JSON.stringify(newOrders) !== JSON.stringify(currentOrdersByPrio)) {
			currentOrdersByPrio = newOrders;
			Toastify({
				text: `Obtained new orders for a total of ${newOrders.length} pixels`,
				duration: TOAST_DURATION
			}).showToast();
		}
	}).catch((e) => console.warn('Couldn\'t get orders', e));
}

async function executeOrders() {
	var ctx;
	try {
		const canvasUrl = await getCurrentImageUrl();
		ctx = await getCanvasFromUrl(canvasUrl);
	} catch (e) {
		console.warn('Error obtaining map', e);
		Toastify({
			text: `Couldn\'t get map. Trying again in ${MAP_ERROR_RETRY_DELAY / 1000} seconds...`,
			duration: MAP_ERROR_RETRY_DELAY
		}).showToast();
		setTimeout(executeOrders, MAP_ERROR_RETRY_DELAY);
		return;
	}

	for (orders of currentOrdersByPrio) {
		for (const order of orders) {
			const x = order[0];
			const y = order[1];
			const colorId = order[2];
			const rgbaAtLocation = ctx.getImageData(x, y, 1, 1).data;
			const hex = rgbToHex(rgbaAtLocation[0], rgbaAtLocation[1], rgbaAtLocation[2]);
			const currentColorId = COLOR_TO_INDEX[hex];
	
			// If the pixel color is already correct skip
			if (currentColorId == colorId) continue;
	
			Toastify({
				text: `Fixing wrong pixel on ${x}, ${y}. Changing from ${INDEX_TO_NAME[currentColorId]} to ${INDEX_TO_NAME[colorId]}`,
				duration: TOAST_DURATION
			}).showToast();
			const res = await place(x, y, colorId);
			const data = await res.json();
	
			try {
				if (data.errors) {
					const error = data.errors[0];
					const nextPixel = error.extensions.nextAvailablePixelTs + 3000;
					const nextPixelDate = new Date(nextPixel);
					const delay = nextPixelDate.getTime() - Date.now();
					Toastify({
						text : `Too early to place pixel! Next pixel at ${ nextPixelDate.toLocaleTimeString()}`,
						duration: delay
					}).showToast();
					setTimeout(executeOrders, delay);
				} else {
					const nextPixel = data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000;
					const nextPixelDate = new Date(nextPixel);
					const delay = nextPixelDate.getTime() - Date.now();
					Toastify({
						text : `Pixel placed on ${x}, ${y}! Next pixel at ${nextPixelDate.toLocaleTimeString()}`,
						duration: delay
					}).showToast();
					setTimeout(executeOrders, delay);
				}
			} catch (e) {
				console.warn ('Error parsing response', e);
				Toastify({
					text : `Error parsing response after placing pixel. Trying again in ${PARSE_ERROR_RETRY_DELAY / 1000} seconds...`,
					duration: PARSE_ERROR_RETRY_DELAY
				}).showToast();
				setTimeout(executeOrders, PARSE_ERROR_RETRY_DELAY);
			}
	
			return;
		}
	}

	Toastify({
		text: `Every pixel is correct! checking again in ${CHECK_AGAIN_DELAY / 1000} seconds...`,
		duration: CHECK_AGAIN_DELAY
	}).showToast();
	setTimeout(executeOrders, CHECK_AGAIN_DELAY);
}

function place(x, y, color) {
	return fetch('https://gql-realtime-2.reddit.com/query', {
		method: 'POST',
		body: JSON.stringify({
			'operationName': 'setPixel',
			'variables': {
				'input': {
					'actionName': 'r/replace:set_pixel',
					'PixelMessageData': {
						'coordinate': {
							'x': x,
							'y': y
						},
						'colorIndex': color,
						'canvasIndex': 0
					}
				}
			},
			'query': 'mutation setPixel($input: ActInput!) { act(input: $input) { data { ... on BasicMessage { id data { ... on GetUserCooldownResponseMessageData { nextAvailablePixelTimestamp __typename } ... on SetPixelResponseMessageData { timestamp __typename } __typename } __typename } __typename } __typename } }'
		}),
		headers: {
			'origin': 'https://hot-potato.reddit.com',
			'referer': 'https://hot-potato.reddit.com/',
			'apollographql-client-name': 'mona-lisa',
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		}
	});
}

async function getCurrentImageUrl() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws');

		ws.onopen = () => {
			ws.send(JSON.stringify({
				'type': 'connection_init',
				'payload': {
					'Authorization': `Bearer ${accessToken}`
				}
			}));
			ws.send(JSON.stringify({
				'id': '1',
				'type': 'start',
				'payload': {
					'variables': {
						'input': {
							'channel': {
								'teamOwner': 'AFD2022',
								'category': 'CANVAS',
								'tag': '0'
							}
						}
					},
					'extensions': {},
					'operationName': 'replace',
					'query': 'subscription replace($input: SubscribeInput!) { subscribe(input: $input) { id ... on BasicMessage { data { __typename ... on FullFrameMessageData { __typename name timestamp } } __typename } __typename } }'
				}
			}));
		};

		ws.onmessage = (message) => {
			const { data } = message;
			const parsed = JSON.parse(data);

			if (!parsed.payload || !parsed.payload.data || !parsed.payload.data.subscribe || !parsed.payload.data.subscribe.data) return;

			ws.close();
			resolve(parsed.payload.data.subscribe.data.name);
		}

		ws.onerror = reject;
	});
}

function getCanvasFromUrl(url) {
	return new Promise((resolve, reject) => {
		var ctx = canvas.getContext('2d');
		var img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			ctx.drawImage(img, 0, 0);
			resolve(ctx);
		};
		img.onerror = reject;
		img.src = url;
	});
}

function rgbToHex(r, g, b) {
	return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

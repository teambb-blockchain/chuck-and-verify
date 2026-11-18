"use strict";

// The demo batches: what happens to each one on chain, and the story the
// batch page tells about it. scripts/seed-demo.js runs the steps in order.
//
// Steps (target "" is the batch itself, "-L1" is its first lot, "-L1-L2"
// the second lot of that lot):
//   ["inspect", passed]                    the demo inspector records it
//   ["move", target, [a, b, c]]            ship a→b, b confirms, b→c, c confirms…
//                                          a last stop written "~d" is shipped
//                                          but not yet received (in transit)
//   ["split", target, [lbs, lbs, …]]       its holder splits it into lots
//   ["final", target, "sold" | "consumed" | "disposed"]
//   ["recall", target, classNumber]        its processor recalls it
//
// `temperature` (optional) gives one holder's sensor a problem to report:
//   { slug: "warm-truck" }       a short warm spell (a door left open)
//   { slug: "freezer-failure" }  the cold room fails and keeps warming
// Every other leg logs normal cold-chain readings (scripts/seed-demo.js).
//
// Business slugs are in businesses.js. `useByDays` may be fractional; the
// short-dated batch uses minutes so it passes its date soon after seeding.
// `photo` picks one of the site's slide images; `ranch` is fictional.

const DAY = 1;
const MINUTES = (n) => n / (24 * 60);

const BATCHES = [
  {
    id: "BEEF-TX-101", processor: "prairie", lbs: 1200, useByDays: 21 * DAY, cut: "Ribeye", photo: "steakhouse",
    ranch: "Double J Ranch, Hereford, TX",
    story: [
      "Grass-started steers from Double J Ranch were harvested at Prairie Packers and cut into ribeyes.",
      "A refrigerated truck carried the batch to cold storage in Fort Worth, then on to a Houston distributor, which split it three ways: two grocery stores and a Dallas steakhouse each got a lot.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["prairie", "reefer", "lonestar", "gulf"]],
      ["split", "", [400, 400, 400]],
      ["move", "-L1", ["gulf", "corner"]], ["final", "-L1", "sold"],
      ["move", "-L2", ["gulf", "ember"]], ["final", "-L2", "consumed"],
      ["move", "-L3", ["gulf", "bluebonnet"]], ["final", "-L3", "sold"],
    ],
  },
  {
    id: "BEEF-TX-102", processor: "prairie", lbs: 800, useByDays: 12 * DAY, cut: "Ground beef", photo: "backyard",
    ranch: "Canyon Creek Cattle Co., Canyon, TX",
    story: [
      "Prairie Packers sent this batch to a second processor, Hill Country Meats, to be ground. That is a common handoff: one plant harvests, another grinds and packages.",
      "From there it went to a Central Texas distributor, which sent most of it to an Austin grocer and the rest to a barbecue joint in Lockhart.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["prairie", "hillcountry", "reefer", "central"]],
      ["split", "", [500, 300]],
      ["move", "-L1", ["central", "pecan"]], ["final", "-L1", "sold"],
      ["move", "-L2", ["central", "smokering"]], ["final", "-L2", "consumed"],
    ],
  },
  {
    id: "BEEF-TX-103", processor: "redriver", lbs: 600, useByDays: 18 * DAY, cut: "Brisket", photo: "backyard",
    ranch: "Bar M Ranch, Henrietta, TX",
    temperature: { reefer: "warm-truck" },
    story: [
      "A short trip: Red River Beef Co. packed whole briskets and a refrigerated carrier took them straight to Smoke Ring BBQ, where they were smoked and served.",
      "The truck's sensor logged a brief warm spell when a door was left open at a fuel stop. The page shows it as time out of range on that leg.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["redriver", "reefer", "smokering"]],
      ["final", "", "consumed"],
    ],
  },
  {
    id: "BEEF-TX-104", processor: "redriver", lbs: 1000, useByDays: 20 * DAY, cut: "Top sirloin", photo: "shop",
    ranch: "Wichita Valley Ranch, Electra, TX",
    story: [
      "This batch shows beef being divided more than once. The Houston distributor split it in two. A San Antonio grocer split its lot again into smaller lots for the meat case.",
      "Two of those small lots have sold and one is still in the store. The distributor's other lot is on its way to Waco.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["redriver", "lonestar", "gulf"]],
      ["split", "", [600, 400]],
      ["move", "-L1", ["gulf", "corner"]],
      ["split", "-L1", [200, 200, 200]],
      ["final", "-L1-L1", "sold"],
      ["final", "-L1-L2", "sold"],
      ["move", "-L2", ["gulf", "~bluebonnet"]],
    ],
  },
  {
    id: "BEEF-TX-105", processor: "hillcountry", lbs: 450, useByDays: 14 * DAY, cut: "Tenderloin", photo: "steakhouse",
    ranch: "Concho River Ranch, San Angelo, TX",
    story: [
      "Hill Country Meats trimmed whole tenderloins for a single customer, Ember & Oak Steakhouse in Dallas, which served them as filets.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["hillcountry", "reefer", "ember"]],
      ["final", "", "consumed"],
    ],
  },
  {
    id: "BEEF-TX-106", processor: "prairie", lbs: 900, useByDays: 10 * DAY, cut: "Chuck", photo: "processing",
    ranch: "Llano Estacado Feeders, Dimmitt, TX",
    story: [
      "This batch failed USDA inspection at the plant. It never shipped: Prairie Packers disposed of it, and the record shows both the failed inspection and the disposal.",
      "A failed batch staying on the record is the point. In a private database it could quietly disappear.",
    ],
    steps: [
      ["inspect", false],
      ["final", "", "disposed"],
    ],
  },
  {
    id: "BEEF-TX-107", processor: "redriver", lbs: 1500, useByDays: 10 * DAY, cut: "Beef trim", photo: "processing",
    ranch: "Several ranches, North Texas",
    story: [
      "Red River Beef Co. issued a Class I recall after the batch had been split and delivered. Every lot made from it shows the recall automatically.",
      "The Austin grocer and the barbecue restaurant disposed of their lots. The distributor is still holding the third lot until the processor says how to return it.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["redriver", "reefer", "central"]],
      ["split", "", [500, 500, 500]],
      ["move", "-L1", ["central", "pecan"]],
      ["move", "-L2", ["central", "smokering"]],
      ["recall", "", 1],
      ["final", "-L1", "disposed"],
      ["final", "-L2", "disposed"],
    ],
  },
  {
    id: "BEEF-TX-108", processor: "hillcountry", lbs: 700, useByDays: 16 * DAY, cut: "Short ribs", photo: "shop",
    ranch: "Pecos Trail Ranch, Fort Stockton, TX",
    story: [
      "These short ribs sold at Bluebonnet Foods in Waco. Afterward Hill Country Meats found a labeling mistake and issued a Class III recall, the least serious kind.",
      "A recall can still be recorded after beef has sold. That is when shoppers most need to hear about it.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["hillcountry", "reefer", "bluebonnet"]],
      ["final", "", "sold"],
      ["recall", "", 3],
    ],
  },
  {
    id: "BEEF-TX-109", processor: "prairie", lbs: 1100, useByDays: 30 * DAY, cut: "Whole primals", photo: "ranch",
    ranch: "Double J Ranch, Hereford, TX",
    story: [
      "Just packed. Prairie Packers registered this batch and it is waiting for its USDA inspection before it can be trusted to ship.",
    ],
    steps: [],
  },
  {
    id: "BEEF-TX-110", processor: "prairie", lbs: 650, useByDays: MINUTES(20), cut: "Flank steak", photo: "shop",
    ranch: "Canyon Creek Cattle Co., Canyon, TX",
    story: [
      "This demo batch was given a use-by date just minutes after it was packed, so you can see how the page flags beef that is past its date and still on a store shelf.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["prairie", "reefer", "corner"]],
    ],
  },
  {
    id: "BEEF-TX-111", processor: "redriver", lbs: 1300, useByDays: 45 * DAY, cut: "Frozen boxed beef", photo: "truck",
    ranch: "Bar M Ranch, Henrietta, TX",
    story: [
      "Frozen and boxed for later, this batch is sitting at Lone Star Cold Storage in Fort Worth until a buyer calls for it.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["redriver", "lonestar"]],
    ],
  },
  {
    id: "BEEF-TX-112", processor: "hillcountry", lbs: 500, useByDays: 12 * DAY, cut: "Ground beef", photo: "truck",
    ranch: "Concho River Ranch, San Angelo, TX",
    story: [
      "On the road right now. The carrier has picked it up and is driving it to a distributor in Temple, which hasn't confirmed delivery yet.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["hillcountry", "reefer", "~central"]],
    ],
  },
  {
    id: "BEEF-TX-113", processor: "prairie", lbs: 1000, useByDays: 28 * DAY, cut: "Dry-aged strip loin", photo: "steakhouse",
    ranch: "Llano Estacado Feeders, Dimmitt, TX",
    story: [
      "Three processors handled this one. Prairie Packers harvested it, Red River Beef Co. dry-aged it, and Hill Country Meats cut it into steaks.",
      "Each handoff was signed by both sides before it reached a Houston distributor and then Ember & Oak Steakhouse.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["prairie", "redriver", "hillcountry", "gulf", "ember"]],
      ["final", "", "consumed"],
    ],
  },
  {
    id: "BEEF-TX-114", processor: "hillcountry", lbs: 800, useByDays: 14 * DAY, cut: "Chuck roast", photo: "shop",
    ranch: "Pecos Trail Ranch, Fort Stockton, TX",
    story: [
      "The Houston distributor split this batch four ways. Three grocery stores sold their lots and a steakhouse served the fourth.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["hillcountry", "reefer", "gulf"]],
      ["split", "", [200, 200, 200, 200]],
      ["move", "-L1", ["gulf", "corner"]], ["final", "-L1", "sold"],
      ["move", "-L2", ["gulf", "pecan"]], ["final", "-L2", "sold"],
      ["move", "-L3", ["gulf", "bluebonnet"]], ["final", "-L3", "sold"],
      ["move", "-L4", ["gulf", "ember"]], ["final", "-L4", "consumed"],
    ],
  },
  {
    id: "BEEF-TX-115", processor: "redriver", lbs: 400, useByDays: 20 * DAY, cut: "Stew meat", photo: "truck",
    ranch: "Wichita Valley Ranch, Electra, TX",
    temperature: { lonestar: "freezer-failure" },
    story: [
      "A freezer failed at the storage warehouse. The room's sensor recorded the temperature climbing for hours, and Lone Star Cold Storage disposed of the batch rather than risk it.",
    ],
    steps: [
      ["inspect", true],
      ["move", "", ["redriver", "lonestar"]],
      ["final", "", "disposed"],
    ],
  },
];

// Slide images (frontend/public/img/slides) used as batch photos.
const PHOTOS = {
  ranch: { file: "01-ranch-sunrise.webp", alt: "Ranch barn at sunrise" },
  pasture: { file: "03-pasture-cattle.webp", alt: "Cattle grazing in a pasture" },
  processing: { file: "04-processing-inspection.webp", alt: "Inspection at a processing plant" },
  truck: { file: "05-refrigerated-truck.webp", alt: "Refrigerated truck on a highway" },
  shop: { file: "06-shop-aisle.webp", alt: "Meat case in a grocery store" },
  backyard: { file: "07-backyard-supper.webp", alt: "Backyard supper" },
  steakhouse: { file: "08-steakhouse-dinner.webp", alt: "Steak dinner at a restaurant" },
};

module.exports = { BATCHES, PHOTOS };

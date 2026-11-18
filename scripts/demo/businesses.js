"use strict";

// The demo supply chain's businesses. All fictional, placed in real Texas
// towns so the custody map has somewhere to draw. Each gets its own wallet
// (scripts/seed-demo.js derives it from the slug), the on-chain credentials
// listed in `roles`, and a public profile for the batch page.
//
// Processors also hold CUSTODIAN so they can ship what they register, and so
// one processor can receive another's batch for further processing.

const BUSINESSES = [
  // Processors
  { slug: "prairie", name: "Prairie Packers", city: "Amarillo, TX", lat: 35.222, lng: -101.8313, organization: "processor", roles: ["PROCESSOR", "CUSTODIAN"] },
  { slug: "redriver", name: "Red River Beef Co.", city: "Wichita Falls, TX", lat: 33.9137, lng: -98.4934, organization: "processor", roles: ["PROCESSOR", "CUSTODIAN"] },
  { slug: "hillcountry", name: "Hill Country Meats", city: "San Angelo, TX", lat: 31.4638, lng: -100.437, organization: "processor", roles: ["PROCESSOR", "CUSTODIAN"] },
  // Inspector
  { slug: "usda", name: "USDA inspector (demo)", city: "Dallas, TX", lat: 32.7767, lng: -96.797, organization: "fsis", roles: ["INSPECTOR"] },
  // Custodians
  { slug: "lonestar", name: "Lone Star Cold Storage", city: "Fort Worth, TX", lat: 32.7555, lng: -97.3308, organization: "storage", roles: ["CUSTODIAN"] },
  { slug: "reefer", name: "Panhandle Reefer Lines", city: "Lubbock, TX", lat: 33.5779, lng: -101.8552, organization: "carrier", roles: ["CUSTODIAN"] },
  { slug: "gulf", name: "Gulf Coast Food Distributors", city: "Houston, TX", lat: 29.7604, lng: -95.3698, organization: "distributor", roles: ["CUSTODIAN"] },
  { slug: "central", name: "Central Texas Provisions", city: "Temple, TX", lat: 31.0982, lng: -97.3428, organization: "distributor", roles: ["CUSTODIAN"] },
  { slug: "corner", name: "Corner Market Grocery", city: "San Antonio, TX", lat: 29.4241, lng: -98.4936, organization: "retailer", roles: ["CUSTODIAN"] },
  { slug: "bluebonnet", name: "Bluebonnet Foods", city: "Waco, TX", lat: 31.5493, lng: -97.1467, organization: "retailer", roles: ["CUSTODIAN"] },
  { slug: "pecan", name: "Pecan Street Market", city: "Austin, TX", lat: 30.2849, lng: -97.7341, organization: "retailer", roles: ["CUSTODIAN"] },
  { slug: "ember", name: "Ember & Oak Steakhouse", city: "Dallas, TX", lat: 32.7831, lng: -96.8067, organization: "restaurant", roles: ["CUSTODIAN"] },
  { slug: "smokering", name: "Smoke Ring BBQ", city: "Lockhart, TX", lat: 29.8849, lng: -97.67, organization: "restaurant", roles: ["CUSTODIAN"] },
];

module.exports = { BUSINESSES };

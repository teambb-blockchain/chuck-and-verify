// Lookup-page slideshow: photo, caption, and the point to keep in view when
// the photo is cropped to the carousel's shape (CSS object-position).
// The photos are decorative; the caption carries the meaning.

const DIR = "/frontend/public/img/slides/";

export const slides = [
  { src: DIR + "01-ranch-sunrise.webp", focus: "78% 50%", title: "Prairie Creek Ranch", sub: "Where every batch begins" },
  { src: DIR + "03-pasture-cattle.webp", focus: "30% 50%", title: "Raised on open pasture", sub: "Tagged at the source, tracked on-chain" },
  { src: DIR + "04-processing-inspection.webp", focus: "40% 35%", title: "Inspected and passed", sub: "Every processor credential checked at handoff" },
  { src: DIR + "05-refrigerated-truck.webp", focus: "48% 50%", title: "Cold all the way", sub: "Truck sensors log the temperature on-chain" },
  { src: DIR + "06-shop-aisle.webp", focus: "45% 30%", title: "On the shelf", sub: "Check the label right in the aisle" },
  { src: DIR + "07-backyard-supper.webp", focus: "45% 50%", title: "Sunday supper", sub: "Know exactly what is on the grill" },
  { src: DIR + "08-steakhouse-dinner.webp", focus: "50% 50%", title: "A night out", sub: "Ask where your steak came from" }
];

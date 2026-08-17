/**
 * Catalogue vocabulary.
 *
 * A general-goods retailer rather than a single-category store: the point is a
 * catalogue wide enough that category, collection and brand filters actually
 * partition the data, so the storefront's filtered reads have varied selectivity
 * instead of every query touching the same handful of rows.
 */

export const BRANDS = [
  { name: "Northwind Supply", country: "gb" },
  { name: "Kestrel Optics", country: "de" },
  { name: "Alder & Vale", country: "gb" },
  { name: "Tomo Kitchenware", country: "jp" },
  { name: "Solvang Textiles", country: "dk" },
  { name: "Corvid Audio", country: "us" },
  { name: "Marlowe Paper Co", country: "us" },
  { name: "Fjell Outdoors", country: "no" },
  { name: "Bellweather Home", country: "gb" },
  { name: "Ossola Ceramics", country: "it" },
  { name: "Vantage Fitness", country: "us" },
  { name: "Perrin Leatherworks", country: "fr" },
  { name: "Halden Tools", country: "se" },
  { name: "Quillon Stationery", country: "gb" },
  { name: "Meridian Coffee", country: "es" },
  { name: "Wren & Ashby", country: "gb" },
] as const

export const CATEGORY_TREE = [
  { name: "Home", children: ["Kitchen", "Bedding", "Lighting", "Storage"] },
  { name: "Apparel", children: ["Tops", "Outerwear", "Knitwear", "Accessories"] },
  { name: "Outdoors", children: ["Camping", "Hiking", "Cycling"] },
  { name: "Electronics", children: ["Audio", "Wearables", "Cables"] },
  { name: "Stationery", children: ["Notebooks", "Pens", "Desk"] },
  { name: "Kitchen & Dining", children: ["Cookware", "Tableware", "Coffee"] },
  { name: "Fitness", children: ["Training", "Recovery"] },
  { name: "Bags", children: ["Backpacks", "Totes", "Travel"] },
] as const

export const COLLECTIONS = [
  "New Arrivals",
  "Best Sellers",
  "Winter Essentials",
  "Workspace",
  "Gifts Under 50",
  "Last Chance",
] as const

const NOUNS = [
  "Kettle", "Throw", "Lamp", "Crate", "Tee", "Parka", "Cardigan", "Scarf",
  "Tent", "Flask", "Bidon", "Headphones", "Tracker", "Cable", "Notebook",
  "Fountain Pen", "Desk Mat", "Skillet", "Tumbler", "Grinder", "Kettlebell",
  "Roller", "Backpack", "Tote", "Duffel", "Mug", "Bowl", "Chopping Board",
  "Blanket", "Pillow", "Sconce", "Basket", "Hoodie", "Shell Jacket", "Beanie",
  "Sleeping Bag", "Headlamp", "Multi-tool", "Speaker", "Earbuds",
]

const ADJECTIVES = [
  "Alpine", "Harbour", "Meadow", "Slate", "Ember", "Drift", "Coastal",
  "Foundry", "Linen", "Copper", "Nordic", "Quarry", "Aspen", "Hollow",
  "Ridge", "Atlas", "Beacon", "Cove", "Dune", "Fen", "Glade", "Heath",
]

const MATERIALS = [
  "Stoneware", "Merino", "Oak", "Anodised Aluminium", "Waxed Canvas",
  "Stainless Steel", "Organic Cotton", "Walnut", "Cork", "Recycled Nylon",
]

export function productName(adjIndex: number, nounIndex: number): string {
  return `${ADJECTIVES[adjIndex % ADJECTIVES.length]} ${NOUNS[nounIndex % NOUNS.length]}`
}

export function material(index: number): string {
  return MATERIALS[index % MATERIALS.length]
}

export const COLOUR_OPTIONS = [
  "Black", "Sand", "Forest", "Rust", "Slate", "Cream", "Navy",
] as const

export const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL"] as const

/** Searches customers actually run, including ones the catalogue cannot answer. */
export const SEARCH_TERMS = [
  "wool blanket", "coffee grinder", "hiking boots", "desk lamp", "notebook",
  "waterproof jacket", "cast iron pan", "noise cancelling", "water bottle",
  "leather bag", "linen sheets", "running shoes", "yoga mat", "tent 2 person",
  "wireless earbuds", "fountain pen ink", "ceramic mug", "merino socks",
  "cable organiser", "kettlebell 16kg",
] as const

/** Deliberately unanswerable — these drive the zero-results report. */
export const MISSING_SEARCH_TERMS = [
  "gift card", "washing machine", "iphone case", "dog bed", "car charger",
  "printer paper a3", "espresso machine", "electric scooter",
] as const

export const REVIEW_TITLES = [
  "Exactly what I wanted", "Good but not great", "Better than expected",
  "Would buy again", "Disappointed", "Solid everyday choice",
  "Arrived damaged", "Great quality for the price", "Runs small",
  "Does the job", "Not as pictured", "Excellent finish",
] as const

export const REVIEW_BODIES = [
  "Been using it daily for a few weeks now and it has held up well.",
  "The finish is nicer in person than in the photos. Very happy.",
  "Works fine but the sizing guide is misleading, order one up.",
  "Arrived quickly and well packaged. No complaints so far.",
  "Decent, though I expected slightly heavier material for the price.",
  "Second one I have bought. The first is still going strong.",
  "Stopped working after a fortnight. Support were helpful about it.",
  "Good value. Not premium, but it does exactly what it says.",
  "Colour is a little darker than shown but I actually prefer it.",
  "Fine for occasional use, would not rely on it for anything heavy.",
] as const

export const TICKET_SUBJECTS = [
  "Where is my order?", "Wrong size delivered", "Item arrived damaged",
  "Refund not received", "Cannot apply discount code", "Change delivery address",
  "Missing item from parcel", "Return label not working",
  "Charged twice for one order", "Product care instructions",
] as const

export const TICKET_BODIES = [
  "Order was placed over a week ago and tracking has not updated.",
  "I ordered a medium but received a large. Happy to exchange.",
  "The box was crushed on arrival and the contents are cracked.",
  "The return was collected two weeks ago but no refund has appeared.",
  "The code from your newsletter is rejected at checkout.",
  "Could you send this to my work address instead? Details below.",
] as const

export const FIRST_NAMES = [
  "Amara", "Jonas", "Priya", "Mateo", "Ingrid", "Tomas", "Leila", "Ravi",
  "Sofie", "Emeka", "Hana", "Lukas", "Nadia", "Oscar", "Yuki", "Elena",
  "Dmitri", "Aisha", "Callum", "Mira", "Theo", "Rosa", "Ade", "Freya",
  "Nikhil", "Clara", "Bruno", "Saoirse", "Kenji", "Lina",
] as const

export const LAST_NAMES = [
  "Okafor", "Lindqvist", "Nair", "Duarte", "Halvorsen", "Novak", "Haddad",
  "Iyer", "Bergman", "Adeyemi", "Sato", "Weber", "Farouk", "Lindgren",
  "Tanaka", "Rossi", "Volkov", "Bello", "Fraser", "Kowalski", "Marchetti",
  "Silva", "Dubois", "OConnell", "Reddy", "Fischer", "Costa", "Byrne",
] as const

export const CITIES = [
  { city: "London", country: "gb", postal: "EC1A 1BB" },
  { city: "Berlin", country: "de", postal: "10115" },
  { city: "Copenhagen", country: "dk", postal: "1050" },
  { city: "Stockholm", country: "se", postal: "111 29" },
  { city: "Paris", country: "fr", postal: "75001" },
  { city: "Madrid", country: "es", postal: "28001" },
  { city: "Milan", country: "it", postal: "20121" },
] as const

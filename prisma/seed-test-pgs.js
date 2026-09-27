// Test-data seed: 30 published PG listings with realistic Indian names,
// spread across major cities, each with rooms + available beds so they
// show up in public discovery (pg-tenant) with vacancy.
//
// Run:  node prisma/seed-test-pgs.js
// Re-running is safe - it deletes the previous seed organization (and
// everything under it, via cascades) before recreating it.
//
// Owner login for Pg-org:  seed.owner@pgmet.test / Test@1234

const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

const OWNER_EMAIL = 'seed.owner@pgmet.test';
const OWNER_PASSWORD = 'Test@1234';
const ORG_NAME = 'Sai Krupa Living Spaces (Seed)';

// [name, city, state, locality, postalCode, lat, lng, basePrice]
const PGS = [
  ['Shree Sai Krupa PG for Gents', 'Bengaluru', 'Karnataka', 'Koramangala', '560034', 12.9352, 77.6245, 9500],
  ['Lakshmi Nivas Ladies PG', 'Bengaluru', 'Karnataka', 'HSR Layout', '560102', 12.9116, 77.6474, 10500],
  ['Annapurna Comforts PG', 'Bengaluru', 'Karnataka', 'BTM Layout', '560076', 12.9166, 77.6101, 8000],
  ['Sri Venkateswara Gents PG', 'Bengaluru', 'Karnataka', 'Whitefield', '560066', 12.9698, 77.75, 9000],
  ['Gokul Residency PG', 'Bengaluru', 'Karnataka', 'Marathahalli', '560037', 12.9591, 77.6974, 8500],
  ['Tulsi Ladies Hostel', 'Bengaluru', 'Karnataka', 'Electronic City', '560100', 12.8452, 77.6602, 7500],
  ['Ganesh Kripa Boys PG', 'Pune', 'Maharashtra', 'Hinjewadi', '411057', 18.5913, 73.7389, 8000],
  ['Saraswati Girls PG', 'Pune', 'Maharashtra', 'Kothrud', '411038', 18.5074, 73.8077, 8500],
  ['Shivneri Executive PG', 'Pune', 'Maharashtra', 'Viman Nagar', '411014', 18.5679, 73.9143, 11000],
  ['Dnyaneshwari Co-Living', 'Pune', 'Maharashtra', 'Baner', '411045', 18.559, 73.7868, 12000],
  ['Sri Sai Balaji Mens PG', 'Hyderabad', 'Telangana', 'Madhapur', '500081', 17.4483, 78.3915, 8500],
  ['Padmavathi Ladies Hostel', 'Hyderabad', 'Telangana', 'Gachibowli', '500032', 17.4401, 78.3489, 9000],
  ['Charminar Stay PG', 'Hyderabad', 'Telangana', 'Ameerpet', '500016', 17.4375, 78.4482, 6500],
  ['Kondapur Comfort PG', 'Hyderabad', 'Telangana', 'Kondapur', '500084', 17.4697, 78.3576, 8000],
  ['Meenakshi Ladies PG', 'Chennai', 'Tamil Nadu', 'Velachery', '600042', 12.9815, 80.218, 7500],
  ['Murugan Gents Hostel', 'Chennai', 'Tamil Nadu', 'OMR Thoraipakkam', '600097', 12.9416, 80.2362, 7000],
  ['Kaveri Residency PG', 'Chennai', 'Tamil Nadu', 'T. Nagar', '600017', 13.0418, 80.2341, 9000],
  ['Siddhivinayak Boys PG', 'Mumbai', 'Maharashtra', 'Andheri East', '400069', 19.1136, 72.8697, 14000],
  ['Mahalaxmi Ladies PG', 'Mumbai', 'Maharashtra', 'Powai', '400076', 19.1176, 72.906, 15500],
  ['Navi Mumbai Nest PG', 'Navi Mumbai', 'Maharashtra', 'Vashi', '400703', 19.0771, 72.9986, 10000],
  ['Krishna Kunj PG', 'New Delhi', 'Delhi', 'Laxmi Nagar', '110092', 28.6304, 77.2773, 8000],
  ['Radhe Radhe Girls PG', 'New Delhi', 'Delhi', 'Mukherjee Nagar', '110009', 28.7061, 77.2106, 9000],
  ['Rajdhani Boys Hostel', 'New Delhi', 'Delhi', 'Kamla Nagar', '110007', 28.6814, 77.2052, 9500],
  ['Durga Niwas Ladies PG', 'Noida', 'Uttar Pradesh', 'Sector 62', '201309', 28.6273, 77.3725, 8500],
  ['Ganga Residency PG', 'Noida', 'Uttar Pradesh', 'Sector 18', '201301', 28.5708, 77.3261, 9500],
  ['Aravali Executive PG', 'Gurugram', 'Haryana', 'DLF Phase 3', '122002', 28.4949, 77.0895, 13000],
  ['Surya Co-Living Spaces', 'Gurugram', 'Haryana', 'Sohna Road', '122018', 28.4231, 77.0395, 12500],
  ['Narmada Gents PG', 'Ahmedabad', 'Gujarat', 'Navrangpura', '380009', 23.0365, 72.5611, 7000],
  ['Ambika Girls Hostel', 'Jaipur', 'Rajasthan', 'Malviya Nagar', '302017', 26.8549, 75.8243, 6500],
  ['Howrah Bridge View PG', 'Kolkata', 'West Bengal', 'Salt Lake Sector V', '700091', 22.5726, 88.4339, 7000],
];

const STREETS = ['1st Main Road', '5th Cross', 'Station Road', 'MG Road', 'Temple Street', 'Gandhi Nagar Main Road', 'Nehru Marg', 'Ring Road'];
const LISTING_AMENITIES = ['WIFI', 'LAUNDRY', 'PARKING', 'AC', 'POWER_BACKUP', 'HOUSEKEEPING', 'SECURITY', 'CCTV', 'FOOD', 'GYM', 'COMMON_AREA'];
const ROOM_LAYOUTS = [
  { roomType: 'SINGLE', capacity: 1, mult: 1.6, amenities: ['AC', 'WIFI', 'ATTACHED_WASHROOM', 'STUDY_TABLE', 'ALMARI', 'GEYSER'] },
  { roomType: 'DOUBLE', capacity: 2, mult: 1.2, amenities: ['AC', 'WIFI', 'ATTACHED_WASHROOM', 'ALMARI', 'GEYSER'] },
  { roomType: 'TRIPLE', capacity: 3, mult: 1.0, amenities: ['FAN', 'WIFI', 'ALMARI', 'GEYSER'] },
  { roomType: 'FOUR', capacity: 4, mult: 0.85, amenities: ['FAN', 'WIFI', 'ALMARI'] },
];

function pick(arr, i, n) {
  // deterministic subset so reruns produce the same data
  return arr.filter((_, k) => (k * 7 + i * 3) % arr.length < n);
}

function roundTo(n, step) {
  return Math.round(n / step) * step;
}

async function main() {
  const passwordHash = await argon2.hash(OWNER_PASSWORD, { type: argon2.argon2id });

  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { passwordHash, status: 'ACTIVE' },
    create: { email: OWNER_EMAIL, name: 'Ramesh Kulkarni', passwordHash },
  });

  // Wipe previous seed run (cascades to properties/rooms/beds/listings).
  const old = await prisma.organization.findMany({
    where: { name: ORG_NAME, memberships: { some: { userId: owner.id } } },
    select: { id: true },
  });
  if (old.length) {
    await prisma.organization.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    console.log(`Removed ${old.length} previous seed org(s).`);
  }

  const org = await prisma.organization.create({
    data: {
      name: ORG_NAME,
      memberships: { create: { userId: owner.id, role: 'OWNER' } },
    },
  });

  for (let i = 0; i < PGS.length; i++) {
    const [name, city, state, locality, postalCode, lat, lng, base] = PGS[i];
    const isLadies = /ladies|girls/i.test(name);
    const layouts = ROOM_LAYOUTS.filter((_, k) => k !== i % 4 || i % 3 === 0);
    const floors = 2 + (i % 3);

    const property = await prisma.property.create({
      data: {
        organizationId: org.id,
        name,
        propertyType: /co-living/i.test(name) ? 'CO_LIVING' : /hostel/i.test(name) ? 'HOSTEL' : 'PG',
        addressLine1: `${10 + i * 3}, ${STREETS[i % STREETS.length]}`,
        addressLine2: `Near ${locality} Bus Stop`,
        city,
        state,
        postalCode,
      },
    });

    let minPrice = Infinity;
    let roomSeq = 0;
    for (let floor = 1; floor <= floors; floor++) {
      for (const [idx, layout] of layouts.entries()) {
        roomSeq++;
        const price = roundTo(base * layout.mult, 500);
        minPrice = Math.min(minPrice, price);
        await prisma.room.create({
          data: {
            propertyId: property.id,
            roomNumber: `${floor}${String(idx + 1).padStart(2, '0')}`,
            floor,
            roomType: layout.roomType,
            capacity: layout.capacity,
            pricePerBed: price,
            amenities: layout.amenities,
            imageUrl: `https://picsum.photos/seed/pgroom-${i}-${roomSeq}/800/500`,
            description: `${layout.roomType.toLowerCase()} sharing room on floor ${floor}, well ventilated with daily cleaning.`,
            beds: {
              create: Array.from({ length: layout.capacity }, (_, b) => ({
                bedNumber: `B${b + 1}`,
                berth: layout.capacity === 4 ? (b % 2 === 0 ? 'LOWER' : 'UPPER') : null,
              })),
            },
          },
        });
      }
    }

    const amenities = pick(LISTING_AMENITIES, i, 7);
    if (!amenities.includes('WIFI')) amenities.push('WIFI');

    await prisma.propertyListing.create({
      data: {
        organizationId: org.id,
        propertyId: property.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        title: `${name} - ${locality}`,
        description:
          `${name} is a ${isLadies ? 'safe and secure ladies-only' : 'well-maintained'} accommodation in ${locality}, ${city}. ` +
          `Homely North & South Indian food, 24x7 water supply, power backup and regular housekeeping. ` +
          `Walking distance to metro/bus stop, supermarkets and IT offices. Ideal for working professionals and students.`,
        city,
        locality,
        latitude: lat,
        longitude: lng,
        coverImageUrl: `https://picsum.photos/seed/pgcover-${i}/1200/700`,
        startingFromPrice: minPrice,
        amenities: { create: amenities.map((amenity) => ({ amenity })) },
      },
    });

    console.log(`${String(i + 1).padStart(2)}. ${name} (${locality}, ${city}) - ${roomSeq} rooms, from Rs ${minPrice}`);
  }

  console.log(`\nDone. Org "${ORG_NAME}" with ${PGS.length} published PGs.`);
  console.log(`Owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

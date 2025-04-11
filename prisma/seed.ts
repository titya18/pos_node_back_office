import process from "process";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create a Branch
  const branch = await prisma.branch.create({
    data: { name: "Main Branch", address: "123 Main St" }
  });

  const roles = await prisma.role.createMany({
    data: [
      { name: "Admin" },
      { name: "Staff" },
    ],
  });
  console.log("✅ Roles created successfully!");

  const modules = await prisma.module.createMany({
    data: [
      { name: "User" },
      { name: "Role" },
      { name: "Permission" },
      { name: "Branch" },
      { name: "Payment Method" },
      { name: "Product" },
      { name: "Category" },
      { name: "Brand" },
      { name: "Unit" },
      { name: "Supplier" },
      { name: "Purchase" },
      { name: "Product Variant" },
    ],
  });

  console.log("✅ Modules created successfully!");

  const permissions = await prisma.permission.createMany({
    data: [
      { name: "User-View", moduleId: 1 },
      { name: "User-Create", moduleId: 1 },
      { name: "User-Edit", moduleId: 1 },
      { name: "User-Delete", moduleId: 1 },
      { name: "Role-View", moduleId: 2 },
      { name: "Role-Create", moduleId: 2 },
      { name: "Role-Edit", moduleId: 2 },
      { name: "Role-Delete", moduleId: 2 },
      { name: "Permission-View", moduleId: 3 },
      { name: "Permission-Create", moduleId: 3 },
      { name: "Permission-Edit", moduleId: 3 },
      { name: "Permission-Delete", moduleId: 3 },
      { name: "Branch-View", moduleId: 4 },
      { name: "Branch-Create", moduleId: 4 },
      { name: "Branch-Edit", moduleId: 4 },
      { name: "Branch-Delete", moduleId: 4 },
      { name: "Payment-Method-View", moduleId: 5 },
      { name: "Payment-Method-Create", moduleId: 5 },
      { name: "Payment-Method-Edit", moduleId: 5 },
      { name: "Payment-Method-Delete", moduleId: 5 },
      { name: "Product-View", moduleId: 6 },
      { name: "Product-Create", moduleId: 6 },
      { name: "Product-Edit", moduleId: 6 },
      { name: "Product-Delete", moduleId: 6 },
      { name: "Category-View", moduleId: 7 },
      { name: "Category-Create", moduleId: 7 },
      { name: "Category-Edit", moduleId: 7 },
      { name: "Category-Delete", moduleId: 7 },
      { name: "Brand-View", moduleId: 8 },
      { name: "Brand-Create", moduleId: 8 },
      { name: "Brand-Edit", moduleId: 8 },
      { name: "Brand-Delete", moduleId: 8 },
      { name: "Unit-View", moduleId: 9 },
      { name: "Unit-Create", moduleId: 9 },
      { name: "Unit-Edit", moduleId: 9 },
      { name: "Unit-Delete", moduleId: 9 },
      { name: "Supplier-View", moduleId: 10 },
      { name: "Supplier-Create", moduleId: 10 },
      { name: "Supplier-Edit", moduleId: 10 },
      { name: "Supplier-Delete", moduleId: 10 },
      { name: "Purchase-View", moduleId: 11 },
      { name: "Purchase-Create", moduleId: 11 },
      { name: "Purchase-Edit", moduleId: 11 },
      { name: "Purchase-Delete", moduleId: 11 },
      { name: "Purchase-Payment", moduleId: 11 },
      { name: "Variant-View", moduleId: 12 },
      { name: "Variant-Create", moduleId: 12 },
      { name: "Variant-Edit", moduleId: 12 },
      { name: "Variant-Delete", moduleId: 12 },
    ],
  });

  console.log("✅ Permissions created successfully!");

  // Hash the password
  const hashedPassword = await bcrypt.hash("admin@123", 10);
  // Example Admin User
  const adminUser = await prisma.user.create({
    data: {
      firstName: "Titya",
      lastName: "Lorn",
      phoneNumber: "1234567890",
      email: "admin@gmail.com",
      password: hashedPassword, // In a real application, hash the password!
      roleType: "ADMIN",
    },
  });

  console.log("✅ Users Admin created successfully!");


  // Create Categories
  const category = await prisma.categories.create({
    data: { name: "Electronics", code: "ELEC" }
  });

  // Create Brands
  const brand = await prisma.brands.create({
    data: { name: "Apple", description: "Apple Inc." }
  });

  // Create Units
  const unit = await prisma.units.create({
    data: { name: "Piece" }
  });

  // Create Products
  const product = await prisma.products.create({
    data: {
      name: "iPhone 15",
      categoryId: category.id,
      brandId: brand.id,
      image: ["iphone15.jpg"],
      stockAlert: 5
    }
  });

  // Create Product Variants
  const variant = await prisma.productVariants.create({
    data: {
      name: "iPhone 15 - 128GB",
      productId: product.id,
      unitId: unit.id,
      code: "IPH15-128",
      purchasePrice: 900.00,
      retailPrice: 1100.00,
      wholeSalePrice: 950.00
    }
  });

  // Create Stock
  const stock = await prisma.stocks.create({
    data: {
      branchId: branch.id,
      productVariantId: variant.id,
      qty: 10
    }
  });

  // Create Suppliers
  const supplier = await prisma.suppliers.create({
    data: {
      name: "Tech Supplier",
      phone: "5551234",
      email: "supplier@example.com"
    }
  });

  // Create Purchases
  const purchase = await prisma.purchases.create({
    data: {
      userId: adminUser.id,
      branchId: branch.id,
      supplierId: supplier.id,
      ref: "PUR-001",
      date: "2025-03-05",
      grandTotal: 9000.00,
      paidAmount: 5000.00,
      status: "Pending",
      paymentStatus: "Partial"
    }
  });

  // Create Purchase Details
  await prisma.purchaseDetails.create({
    data: {
      purchaseId: purchase.id,
      productId: product.id,
      productVariantId: variant.id,
      cost: 900.00,
      total: 9000.00,
      quantity: 10
    }
  });

  // Create Payment Methods
  const cashPayment = await prisma.paymentMethods.create({
    data: { name: "Cash_Test" }
  });

  // Create Purchase Payment
  await prisma.purchaseOnPayments.create({
    data: {
      branchId: branch.id,
      purchaseId: purchase.id,
      paymentMethodId: cashPayment.id,
      userId: adminUser.id,
      amount: 5000.00
    }
  });

  console.log("✅ Database seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


// How to run this seed type npm run seed
// npm run seed
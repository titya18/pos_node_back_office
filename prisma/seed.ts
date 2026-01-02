import process from "process";
import bcrypt from "bcrypt";
import { PrismaClient, UnitType } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  console.log("🌱 Seeding database...");

  // Create a Branch
  const branch1 = await prisma.branch.create({
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
      { name: "Category" },
      { name: "Brand" },
      { name: "Supplier" },
      { name: "Unit" },
      { name: "Varient Attribute" },
      { name: "Product" },
      { name: "Product Variant" },
      { name: "Purchase" },
      { name: "Payment Method" },
      { name: "Customer" },
      { name: "Service" },
      { name: "Quotation" },
      { name: "Invoice" },
      { name: "Stock" },
      { name: "Adjust Stock" },
      { name: "Stock Transfer" },
      { name: "Stock Request" },
      { name: "Stock Return" },
      { name: "Expense" },
      { name: "Income" },
      { name: "Reports" }
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
      { name: "Category-View", moduleId: 5 },
      { name: "Category-Create", moduleId: 5 },
      { name: "Category-Edit", moduleId: 5 },
      { name: "Category-Delete", moduleId: 5 },
      { name: "Brand-View", moduleId: 6 },
      { name: "Brand-Create", moduleId: 6 },
      { name: "Brand-Edit", moduleId: 6 },
      { name: "Brand-Delete", moduleId: 6 },
      { name: "Supplier-View", moduleId: 7 },
      { name: "Supplier-Create", moduleId: 7 },
      { name: "Supplier-Edit", moduleId: 7 },
      { name: "Supplier-Delete", moduleId: 7 },
      { name: "Unit-View", moduleId: 8 },
      { name: "Unit-Create", moduleId: 8 },
      { name: "Unit-Edit", moduleId: 8 },
      { name: "Unit-Delete", moduleId: 8 },
      { name: "Variant-Attribute-View", moduleId: 9 },
      { name: "Variant-Attribute-Create", moduleId: 9 },
      { name: "Variant-Attribute-Edit", moduleId: 9 },
      { name: "Variant-Attribute-Delete", moduleId: 9 },
      { name: "Product-View", moduleId: 10 },
      { name: "Product-Create", moduleId: 10 },
      { name: "Product-Edit", moduleId: 10 },
      { name: "Product-Delete", moduleId: 10 },
      { name: "Product-Variant-View", moduleId: 11 },
      { name: "Product-Variant-Create", moduleId: 11 },
      { name: "Product-Variant-Edit", moduleId: 11 },
      { name: "Product-Variant-Delete", moduleId: 11 },
      { name: "Purchase-View", moduleId: 12 },
      { name: "Purchase-Create", moduleId: 12 },
      { name: "Purchase-Edit", moduleId: 12 },
      { name: "Purchase-Delete", moduleId: 12 },
      { name: "Purchase-Print", moduleId: 12 },
      { name: "Purchase-Receive", moduleId: 12 },
      { name: "Purchase-Payment", moduleId: 12 },
      { name: "Delete-Payment-Purchase", moduleId: 12 },
      { name: "Payment-Method-View", moduleId: 13 },
      { name: "Payment-Method-Create", moduleId: 13 },
      { name: "Payment-Method-Edit", moduleId: 13 },
      { name: "Payment-Method-Delete", moduleId: 13 },
      { name: "Customer-View", moduleId: 14 },
      { name: "Customer-Create", moduleId: 14 },
      { name: "Customer-Edit", moduleId: 14 },
      { name: "Customer-Delete", moduleId: 14 },
      { name: "Service-View", moduleId: 15 },
      { name: "Service-Create", moduleId: 15 },
      { name: "Service-Edit", moduleId: 15 },
      { name: "Service-Delete", moduleId: 15 },
      { name: "Quotation-View", moduleId: 16 },
      { name: "Quotation-Create", moduleId: 16 },
      { name: "Quotation-Edit", moduleId: 16 },
      { name: "Quotation-Delete", moduleId: 16 },
      { name: "Quotation-Print", moduleId: 16 },
      { name: "Quotation-Sent", moduleId: 16 },
      { name: "Convert-QTT-to-INV", moduleId: 16 },
      { name: "Invoice-View", moduleId: 17 },
      { name: "Invoice-Create", moduleId: 17 },
      { name: "Invoice-Edit", moduleId: 17 },
      { name: "Invoice-Delete", moduleId: 17 },
      { name: "Invoice-Print", moduleId: 17 },
      { name: "Invoice-Approve", moduleId: 17 },
      { name: "Invoice-Payment", moduleId: 17 },
      { name: "Delete-Payment-Invoice", moduleId: 17 },
      { name: "Check-Stock", moduleId: 18 },
      { name: "Adjust-Stock-View", moduleId: 19 },
      { name: "Adjust-Stock-Create", moduleId: 19 },
      { name: "Adjust-Stock-Edit", moduleId: 19 },
      { name: "Adjust-Stock-Delete", moduleId: 19 },
      { name: "Adjust-Stock-Approve", moduleId: 19 },
      { name: "Stock-Movement-View", moduleId: 20 },
      { name: "Stock-Movement-Create", moduleId: 20 },
      { name: "Stock-Movement-Edit", moduleId: 20 },
      { name: "Stock-Movement-Delete", moduleId: 20 },
      { name: "Stock-Movement-Approve", moduleId: 20 },
      { name: "Stock-Request-View", moduleId: 21 },
      { name: "Stock-Request-Create", moduleId: 21 },
      { name: "Stock-Request-Edit", moduleId: 21 },
      { name: "Stock-Request-Delete", moduleId: 21 },
      { name: "Stock-Request-Approve", moduleId: 21 },
      { name: "Stock-Return-View", moduleId: 22 },
      { name: "Stock-Return-Create", moduleId: 22 },
      { name: "Stock-Return-Edit", moduleId: 22 },
      { name: "Stock-Return-Delete", moduleId: 22 },
      { name: "Stock-Return-Approve", moduleId: 22 },
      { name: "Expense-View", moduleId: 23 },
      { name: "Expense-Create", moduleId: 23 },
      { name: "Expense-Edit", moduleId: 23 },
      { name: "Expense-Delete", moduleId: 23 },
      { name: "Income-View", moduleId: 24 },
      { name: "Income-Create", moduleId: 24 },
      { name: "Income-Edit", moduleId: 24 },
      { name: "Income-Delete", moduleId: 24 },
      { name: "Invoice-Report", moduleId: 25 },
      { name: "Cancel-Invoice", moduleId: 25 },
      { name: "Payment-Report", moduleId: 25 },
      { name: "Quotation-Report", moduleId: 25 },
      { name: "Purchase-Report", moduleId: 25 },
      { name: "Payment-Purchase-Report", moduleId: 25 },
      { name: "Adjustment-Report", moduleId: 25 },
      { name: "Transfer-Report", moduleId: 25 },
      { name: "Request-Report", moduleId: 25 },
      { name: "Return-Report", moduleId: 25 },
      { name: "Expense-Report", moduleId: 25 },
      { name: "Income-Report", moduleId: 25 },
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
    data: {
      name: 'Beverages', code: 'CAT001'
    }
  });
  console.log("✅ Users Category created successfully!");

  // Create Brands
  const brand = await prisma.brands.create({
    data: { en_name: "Brand A", kh_name: "ខ្មែរប្រេន", description: "High quality brand" }
  });
  console.log("✅ Users Brand created successfully!");

  // Create Units
  const unit = await prisma.units.createMany({
    data: [
      { name: 'kg', type: UnitType.WEIGHT },
      { name: 'pcs', type: UnitType.QUANTITY }
    ]
  });
  console.log("✅ Users Unit created successfully!");

  // Create Brands
  const service = await prisma.services.create({
    data: { 
      serviceCode: "SRV001",
      name: "Service A",
      description: "High quality service",
      price: 100.0
    }
  });
  console.log("✅ Users Service created successfully!");


  const product1 = await prisma.products.create({
    data: {
      categoryId: 1,
      brandId: 1,
      name: 'Coca Cola',
      image: ['coke.jpg'],
      note: 'Popular drink',
      isActive: 1
    }
  });
  console.log("✅ Users Product created successfully!");

  await prisma.variantAttribute.createMany({
    data: [
      { name: 'Size' },
      { name: 'Color' }
    ]
  });
  console.log("✅ Users Varient Attribute created successfully!");

  await prisma.variantValue.createMany({
    data: [
      { variantAttributeId: 1, value: 'Small' },
      { variantAttributeId: 1, value: 'Large' },
      { variantAttributeId: 2, value: 'Red' },
      { variantAttributeId: 2, value: 'Blue' }
    ]
  });
  console.log("✅ Users Varient Value created successfully!");

  const variantValues = await prisma.variantValue.findMany();

  const small = variantValues.find((v) => v.value === "Small");
  const red = variantValues.find((v) => v.value === "Red");

  // Validate them before using
  if (!small || !red) {
    throw new Error("❌ Required variant values (Small/Red) not found!");
  }

  // Create Product Variant
  const variant1 = await prisma.productVariants.create({
    data: {
      productId: product1.id,
      unitId: 2,
      sku: 'SKU001',
      barcode: '1234567890123',
      stockAlert: 10,
      name: 'Coca Cola Small',
      image: ['coke_small.jpg'],
      purchasePrice: 0.5,
      retailPrice: 1.0,
      wholeSalePrice: 0.8,
      isActive: 1
    }
  });
  console.log("✅ Users Product Variant created successfully!");

  // -------------------------------
  // Link ProductVariantValues
  // -------------------------------
  await prisma.productVariantValues.createMany({
    data: [
      { productVariantId: variant1.id, variantValueId: small.id },
      { productVariantId: variant1.id, variantValueId: red.id },
    ],
  });

  console.log("✅ Product Variant Values linked!");

  await prisma.stocks.create({
    data: {
      productVariantId: variant1.id,
      quantity: 100.0,
      branchId: branch1.id
    }
  });
  console.log("✅ Users Stock created successfully!");

  // Create Suppliers
  const supplier1 = await prisma.suppliers.create({
    data: {
      name: "Tech Supplier",
      phone: "5551234",
      email: "supplier@example.com"
    }
  });
  console.log("✅ Users Supplier created successfully!");

  await prisma.paymentMethods.createMany({
    data: [
      { name: 'Cash' },
      { name: 'Credit Card' },
      { name: 'Bank Transfer' },
    ],
  });
  console.log("✅ Users Payment Method created successfully!");

  const purchase1 = await prisma.purchases.create({
    data: {
      userId: adminUser.id,
      branchId: branch1.id,
      supplierId: supplier1.id,
      ref: 'PUR-0001',
      purchaseDate: new Date('2025-05-15'),
      taxRate: 0.1,
      taxNet: 10,
      discount: 5,
      shipping: 3,
      grandTotal: 200,
      paidAmount: 150,
      status: 'COMPLETED',
      paymentStatus: 'PARTIAL',
      note: 'First purchase',
      createdAt: now,
      updatedAt: now,
      purchaseDetails: {
        create: [
          {
            productId: product1.id,
            productVariantId: variant1.id,
            cost: 10,
            taxNet: 1,
            taxMethod: 'inclusive',
            discount: 0,
            discountMethod: 'none',
            total: 10,
            quantity: 10,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      payments: {
        create: [
          {
            branchId: branch1.id,
            paymentMethodId: 1, // Cash
            userId: adminUser.id,
            amount: 100,
            createdAt: now,
          },
          {
            branchId: branch1.id,
            paymentMethodId: 2, // Credit Card
            userId: adminUser.id,
            amount: 50,
            createdAt: now,
          },
        ],
      },
    },
  });
  console.log("✅ Users Purchase created successfully!");

  // Seed StockMovements
  await prisma.stockMovements.create({
    data: {
      productVariantId: variant1.id,
      branchId: branch1.id,
      type: 'ADJUSTMENT',
      AdjustMentType: 'POSITIVE',
      status: 'APPROVED',
      quantity: 10,
      note: 'Initial stock added',
      createdAt: now,
    },
  });
  console.log("✅ Users Stock Movement created successfully!");

  // Seed Customer
  const customer1 = await prisma.customer.create({
    data: {
      name: 'Jane Smith',
      phone: '0912345678',
      email: 'jane.smith@example.com',
      address: '456 Customer Rd',
      createdAt: now,
    },
  });
  console.log("✅ Users Customer created successfully!");

  // Seed Order with OrderItems and Sale
  const order1 = await prisma.order.create({
    data: {
      branchId: branch1.id,
      ref: 'INV-0001',
      OrderSaleType: 'RETAIL',
      customerId: customer1.id,
      orderDate: now,
      status: 'PENDING',
      totalAmount: 150,
      items: {
        create: [
          {
            productId: product1.id,
            productVariantId: variant1.id,
            serviceId: null,
            ItemType: 'PRODUCT',
            quantity: 5,
            price: 15,
            total: 75,
          },
        ],
      },
      orderOnPayments: {
        create: {
          branchId: branch1.id,
          paymentDate: now,
          paymentMethodId: 1,
          totalPaid: 150,
        },
      },
    },
  });
  console.log("✅ Users Order created successfully!");

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
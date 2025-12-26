import express from 'express';
import cors from "cors";
import path from 'path';
import cookieParser from "cookie-parser";
import helmet from 'helmet';

import authRoute from './routes/authRoute';
import branchRoute from './routes/branchRoute';
import paymentMethodRoute from './routes/paymentMethodRoute';
import userRoute from './routes/userRoute';
import module_permissionRoute from './routes/module_permissionRoute';
import permissionRoute from './routes/permissionRoute';
import roleRoute from './routes/roleRoute';
import categoryRoute from './routes/categoryRoute';
import unitRoute from './routes/unitRoute';
import brandRoute from './routes/brandRoute';
import variantAttributeRoute from './routes/variantAttributeRoute';
import productRoute from './routes/productRoute';
import productVariantRoute from './routes/productVariantRoute';
import supplierRoute from './routes/supplierRoute';
import purchaseRoute from './routes/purchaseRoute';
import searchProductRoute from './routes/searchProductRoute';
import searchServiceRoute from './routes/searchServiceRoute';
import serviceRoute from './routes/serviceRoute';
import quotationRoute from './routes/quotationRoute';
import customerRoute from './routes/customerRoute';
import invoiceRoute from './routes/invoiceRoute';
import stockRoute from './routes/stockRoute';
import stockAdjustmentRoute from './routes/stockAdjustmentRoute';
import stockTransferRoute from './routes/stockTransferRoute';
import stockRequestRoute from './routes/stockRequestRoute';
import stockReturnRoute from './routes/stockReturnRoute';
import expenseRoute from './routes/expenseRoute';
import incomeRoute from './routes/incomeRoute';
import reportRoute from './routes/reportRoute';

const app = express();

// Serve the 'public' folder as the root for static files
// Serve static images

// Note: If doesn't show image on frontend, we just add/remove ../.. like this behide of /public
const publicPath = path.resolve(__dirname, '../public');
// const publicPath = path.resolve(__dirname, '../public');
app.use('/images', express.static(path.join(publicPath, 'images')));

// console.log('Static images path:', path.join(publicPath, 'images'));

// Security middleware
app.use(helmet());

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
);

// Default route for the root path
app.get('/', (req, res) => {
  res.send("Welcome to the Stock Management API");
});


// API Routes
app.use('/api/auth', authRoute);
app.use('/api/branch', branchRoute);
app.use('/api/paymentmethod', paymentMethodRoute);
app.use('/api/user', userRoute);
app.use('/api/module_permission', module_permissionRoute);
app.use('/api/permission', permissionRoute);
app.use('/api/role', roleRoute);
app.use('/api/category', categoryRoute);
app.use('/api/unit', unitRoute);
app.use('/api/brand', brandRoute);
app.use('/api/variant_attribute', variantAttributeRoute);
app.use('/api/product', productRoute);
app.use('/api/productvariant', productVariantRoute);
app.use('/api/supplier', supplierRoute);
app.use('/api/purchase', purchaseRoute);
app.use('/api/searchProductRoute', searchProductRoute);
app.use('/api/searchServiceRoute', searchServiceRoute);
app.use('/api/service', serviceRoute);
app.use('/api/quotation', quotationRoute);
app.use('/api/customer', customerRoute);
app.use('/api/invoice', invoiceRoute);
app.use('/api/stock', stockRoute);
app.use('/api/stockadjustment', stockAdjustmentRoute);
app.use('/api/stocktransfer', stockTransferRoute);
app.use('/api/stockrequest', stockRequestRoute);
app.use('/api/stockreturn', stockReturnRoute);
app.use('/api/expense', expenseRoute);
app.use('/api/income', incomeRoute);
app.use('/api/report', reportRoute);

// Default route
app.get("/", (req, res) => {
  res.send("Stock Management API is running...");
});

export default app;

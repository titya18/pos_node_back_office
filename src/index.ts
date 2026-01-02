import express from 'express';
import "dotenv/config";
import cors from "cors";
import http from "http";
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import cookieParser from "cookie-parser";

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
import serviceRoute from './routes/serviceRoute';

const app = express();

// Serve the 'public' folder as the root for static files
const publicPath = path.resolve(__dirname, '../public');
app.use('/images', express.static(path.join(publicPath, 'images')));

// console.log('Static images path:', path.join(publicPath, 'images'));

// I used socket io for real time update user role permission that effect sidebar componen or other components
// For Socket IO
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.FRONTEND_URL,
        methods: ['GET', 'POST'],
        credentials: true,
    },
});
// End for Socket IO

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
)

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
app.use('/api/service', serviceRoute);

// For Socket IO
io.on('connection', (socket) => {
  // console.log('A user connected');

  socket.on('upsertRole', (roleData) => {
      // Emit the updated role permissions along with the role ID
      io.emit('permissionsUpdated', {
        id: roleData.id, // Include the role ID
        permissions: roleData.permissions.map(String) // Ensure permissions are strings
      });
  });

  socket.on('disconnect', () => {
      console.log('User disconnected');
  });
});
// End for Socket IO

// app.use('*', (req, res, next) => {
//   res.status(404).json({ status: 'fail', message: 'Route not found' });
// });

// Commend it when deploy on server
const PORT = process.env.APP_PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend server is running at http://localhost:${PORT}`);
});

// Use it when deploy on server
// app.listen(4000, '0.0.0.0', () => {
//   console.log('Backend server is running on port 4000');
// });


import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import ThreeDView from './pages/ThreeDView';
import Emergency from './pages/Emergency';
import Auth from './pages/Auth';
import Caretaker from './pages/Caretaker';
import WatchBridge from './pages/WatchBridge';
import NotFound from './pages/NotFound';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/contexts/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/3d-view" element={<ThreeDView />} />
          <Route path="/emergency" element={<Emergency />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/signup" element={<Auth />} />
          <Route path="/caretaker" element={<Caretaker />} />
          <Route path="/bridge" element={<WatchBridge />} />
          <Route path="/wearable" element={<WatchBridge />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </Router>
    </ThemeProvider>
  );
}

export default App;
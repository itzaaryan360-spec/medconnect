import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  FileText, Activity, Box, Phone, Shield, Brain,
  Heart, ArrowRight, Zap, Globe
} from "lucide-react";
import Navbar from "@/components/Navbar";

const features = [
  {
    icon: FileText,
    title: "Report Simplification",
    description: "Upload medical reports and get AI-powered plain-language explanations with confidence scoring.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Box,
    title: "3D Anatomy View",
    description: "Interactive 3D human body visualization highlighting affected areas from your reports.",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: Activity,
    title: "Vitals Monitoring",
    description: "Real-time health tracking from wearables with trend analysis and smart alerts.",
    color: "bg-success/10 text-success",
  },
  {
    icon: Phone,
    title: "Emergency SOS",
    description: "Auto-dial 108, share GPS, and notify caretakers with AI-assisted emergency calls.",
    color: "bg-emergency/10 text-emergency",
  },
  {
    icon: Brain,
    title: "AI Health Insights",
    description: "Predictive analytics and personalized recommendations powered by machine learning.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Shield,
    title: "Privacy First",
    description: "End-to-end encryption, consent-driven access, and full audit trails for your data.",
    color: "bg-muted-foreground/10 text-muted-foreground",
  },
];

const stats = [
  { value: "< 2s", label: "Emergency Response" },
  { value: "108", label: "Auto-Dial Support" },
  { value: "12+", label: "Languages Supported" },
  { value: "99.9%", label: "Uptime Target" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" },
  }),
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[image:var(--gradient-hero)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(173_58%_39%/0.08),transparent_50%)]" />
        <div className="container relative flex min-h-[85vh] flex-col items-center justify-center py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary"
          >
            <Zap className="h-3.5 w-3.5" />
            AI-Powered Healthcare Companion
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="max-w-4xl font-display text-5xl font-bold leading-tight tracking-tight md:text-7xl"
          >
            Your Health,{" "}
            <span className="text-gradient-primary">Simplified</span>
            {" "}& Protected
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl"
          >
            Understand your medical reports in plain language, visualize health data in 3D, 
            monitor vitals in real-time, and stay safe with automated emergency response.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <Link to="/auth?mode=signup">
              <Button size="lg" className="gap-2 text-base">
                Start Free <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/emergency">
              <Button size="lg" variant="outline" className="gap-2 border-emergency/30 text-base text-emergency hover:bg-emergency/5">
                <Phone className="h-4 w-4" />
                Emergency SOS
              </Button>
            </Link>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-20 grid w-full max-w-3xl grid-cols-2 gap-6 md:grid-cols-4"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-display text-3xl font-bold text-primary">{stat.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold md:text-4xl">
              Everything You Need for{" "}
              <span className="text-gradient-primary">Smarter Health</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              From understanding medical jargon to emergency auto-response — MedConnect covers it all.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-50px" }}
                  variants={fadeUp}
                >
                  <Card className="group h-full border-border/50 transition-all hover:border-primary/30 hover:shadow-[var(--shadow-card)]">
                    <CardContent className="flex flex-col gap-4 p-6">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${feature.color}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="font-display text-xl font-semibold">{feature.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-primary/[0.03] py-24">
        <div className="container text-center">
          <Heart className="mx-auto h-10 w-10 animate-float text-primary" />
          <h2 className="mt-6 font-display text-3xl font-bold md:text-4xl">
            Ready to Take Control of Your Health?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Join MedConnect today and experience healthcare that's accessible, understandable, and always watching out for you.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link to="/auth?mode=signup">
              <Button size="lg" className="gap-2">
                <Globe className="h-4 w-4" />
                Create Free Account
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary" />
            <span className="font-display font-semibold">MedConnect</span>
          </div>
          <p>© 2026 MedConnect. Built for India. Life-critical grade.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;

import React, { useEffect, useRef } from 'react';

interface GlobeProps {
  onlineUsers: number;
}

export function Globe({ onlineUsers }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const pointsRef = useRef<Array<{
    phi: number;
    theta: number;
    pulse: number;
  }>>([]);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 400;
    canvas.height = 400;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 150;

    // Initialiser 50 points une seule fois avec positions fixes
    if (pointsRef.current.length === 0) {
      pointsRef.current = Array.from({ length: 50 }, () => ({
        phi: Math.random() * Math.PI * 2, // Position initiale aléatoire autour du globe
        theta: Math.random() * Math.PI,   // Latitude aléatoire (0 à π)
        pulse: Math.random() * Math.PI * 2, // Phase de pulsation aléatoire
      }));
      startTimeRef.current = Date.now(); // Temps de démarrage
    }

    function animate() {
      if (!ctx || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw globe outline
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw latitude lines
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        const y = centerY - radius + (radius * 2 * i) / 6;
        const width = Math.sqrt(radius * radius - Math.pow(y - centerY, 2)) * 2;
        
        ctx.beginPath();
        ctx.ellipse(centerX, y, width / 2, width / 8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw longitude lines
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, Math.abs(radius * Math.cos(angle)), radius, angle, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Animation des 50 points avec rotation globale de 1 minute
      const currentTime = Date.now();
      const elapsedTime = currentTime - startTimeRef.current;
      
      // Rotation globale : 1 tour complet (2π radians) en 60 secondes (60000ms)
      const globalRotation = (elapsedTime / 60000) * Math.PI * 2;
      
      pointsRef.current.forEach((point) => {
        // Appliquer la rotation globale à la position phi de chaque point
        const rotatedPhi = point.phi + globalRotation;
        
        // Calculer les coordonnées 3D du point avec la rotation
        const x = centerX + radius * Math.sin(point.theta) * Math.cos(rotatedPhi);
        const y = centerY + radius * Math.cos(point.theta);
        const z = radius * Math.sin(point.theta) * Math.sin(rotatedPhi);
        
        // Dessiner seulement les points visibles (hémisphère avant)
        if (z > -radius * 0.3) {
          // Pulsation subtile
          const pulse = Math.sin(currentTime * 0.002 + point.pulse) * 0.3 + 0.7;
          const size = 1.5 + pulse * 1.5;
          const alpha = 0.4 + pulse * 0.4;
          
          // Effet de profondeur : les points plus proches sont plus brillants
          const depthFactor = (z + radius) / (2 * radius); // 0 à 1
          const finalAlpha = alpha * (0.3 + depthFactor * 0.7);
          
          ctx.fillStyle = `rgba(0, 212, 255, ${finalAlpha})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
          
          // Effet de lueur pour les points les plus proches
          if (depthFactor > 0.6) {
            ctx.shadowColor = '#00D4FF';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []); // Pas de dépendance sur onlineUsers - globe indépendant

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-96 h-96 max-w-full max-h-full"
        style={{ filter: 'drop-shadow(0 0 20px rgba(0, 212, 255, 0.3))' }}
      />
      <div className="absolute inset-0 pointer-events-none">
        <div className="w-full h-full rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 animate-pulse" 
             style={{ animationDuration: '4s' }} />
      </div>
    </div>
  );
}
import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { Scene3DView, Scene3DViewNode } from '@/lib/scene3d';

export type Model3DViewAngle = 'iso' | 'front' | 'top' | 'side';

function colorHex(value: string | undefined): number {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? Number.parseInt(String(value).slice(1), 16) : 0x6a8caf;
}

function geometryFor(node: Scene3DViewNode): THREE.BufferGeometry | null {
  const dims = node.dimensions || {};
  if (node.type === 'box') return new THREE.BoxGeometry(dims.width, dims.depth, dims.height);
  if (node.type === 'sphere') return new THREE.SphereGeometry(dims.radius, 32, 20);
  if (node.type === 'cylinder') return new THREE.CylinderGeometry(dims.radius, dims.radius, dims.height, 32);
  if (node.type === 'plane') return new THREE.PlaneGeometry(dims.width, dims.height);
  return null;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
  });
  group.clear();
}

export interface Model3DCameraApi {
  getView: () => { position: number[]; target: number[] };
  setView: (position: number[], target: number[]) => void;
}

export type Model3DPoint = [number, number, number];

export function Model3DScene({
  view,
  viewAngle,
  modelUrl,
  modelFormat = 'glb',
  onReady,
  onError,
  onSelectNode,
  measureMode = false,
  measurement = null,
  onMeasurePoint,
  onCameraApi,
}: {
  view: Scene3DView | null;
  viewAngle: Model3DViewAngle;
  modelUrl?: string | null;
  modelFormat?: 'glb' | 'stl' | 'obj';
  onReady?: (info: { objects: number; bounds: number[] }) => void;
  onError?: (message: string) => void;
  onSelectNode?: (nodeId: string | null) => void;
  measureMode?: boolean;
  measurement?: { a: Model3DPoint; b: Model3DPoint } | null;
  onMeasurePoint?: (point: Model3DPoint) => void;
  onCameraApi?: (api: Model3DCameraApi | null) => void;
}): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const contentRef = React.useRef<THREE.Group | null>(null);
  const overlayRef = React.useRef<THREE.Group | null>(null);
  const boundsRef = React.useRef(new THREE.Box3());

  const applyView = React.useCallback((angle: Model3DViewAngle) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const box = boundsRef.current;
    const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(100, 80, 60) : box.getSize(new THREE.Vector3());
    const distance = Math.max(40, Math.max(size.x, size.y, size.z) * 2.2);
    const positions: Record<Model3DViewAngle, THREE.Vector3> = {
      iso: new THREE.Vector3(center.x + distance * 0.8, center.y - distance * 0.8, center.z + distance * 0.65),
      front: new THREE.Vector3(center.x, center.y - distance, center.z),
      top: new THREE.Vector3(center.x, center.y, center.z + distance),
      side: new THREE.Vector3(center.x + distance, center.y, center.z),
    };
    camera.position.copy(positions[angle]);
    camera.up.set(0, 0, 1);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  }, []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'webgl_unavailable');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 640, host.clientHeight || 420);
    renderer.domElement.dataset.testid = 'model3d-canvas';
    const onContextLost = (event: Event) => {
      event.preventDefault();
      onError?.('webgl_context_lost');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, (host.clientWidth || 640) / (host.clientHeight || 420), 0.1, 1_000_000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    const grid = new THREE.GridHelper(400, 20, 0x33506a, 0x1d3042);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(80));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x203040, 1.2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.1);
    directional.position.set(120, -180, 220);
    scene.add(directional);
    const content = new THREE.Group();
    scene.add(content);
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    contentRef.current = content;
    overlayRef.current = new THREE.Group();
    scene.add(overlayRef.current);
    onCameraApi?.({
      getView: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
      setView: (position, target) => {
        camera.position.fromArray(position);
        controls.target.fromArray(target);
        controls.update();
      },
    });
    const resize = new ResizeObserver(() => {
      const width = host.clientWidth || 640;
      const height = host.clientHeight || 420;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      disposeGroup(content);
      if (overlayRef.current) {
        disposeGroup(overlayRef.current);
        overlayRef.current = null;
      }
      onCameraApi?.(null);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
    };
  }, [onCameraApi, onError]);

  // 点选节点：与 OrbitControls 共用指针事件，拖动超过 4px 视为旋转而非选择。
  React.useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const content = contentRef.current;
    if (!renderer || !camera || !content || (!onSelectNode && !measureMode)) return undefined;
    const dom = renderer.domElement;
    let downX = 0;
    let downY = 0;
    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return;
      const rect = dom.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(content.children, false)[0];
      if (measureMode && onMeasurePoint) {
        if (hit) onMeasurePoint([hit.point.x, hit.point.y, hit.point.z]);
        return;
      }
      onSelectNode?.(hit && hit.object.name ? hit.object.name : null);
    };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
    };
  }, [measureMode, onMeasurePoint, onSelectNode]);

  React.useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    disposeGroup(content);
    boundsRef.current = new THREE.Box3();
    if (modelUrl) {
      const finish = (object: THREE.Object3D, objects: number) => {
        content.add(object);
        boundsRef.current.setFromObject(object);
        applyView(viewAngle);
        onReady?.({ objects, bounds: boundsRef.current.getSize(new THREE.Vector3()).toArray() });
      };
      if (modelFormat === 'stl') {
        new STLLoader().load(modelUrl, (geometry) => {
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8aa3b8, roughness: 0.62 }));
          mesh.name = 'imported-stl';
          finish(mesh, 1);
        }, undefined, (error) => onError?.(error instanceof Error ? error.message : 'stl_load_failed'));
      } else if (modelFormat === 'obj') {
        new OBJLoader().load(modelUrl, (group) => {
          group.name = 'imported-obj';
          finish(group, group.children.length);
        }, undefined, (error) => onError?.(error instanceof Error ? error.message : 'obj_load_failed'));
      } else {
        new GLTFLoader().load(modelUrl, (gltf) => {
          finish(gltf.scene, gltf.scene.children.length);
        }, undefined, (error) => onError?.(error instanceof Error ? error.message : 'glb_load_failed'));
      }
      return;
    }
    if (!view) return;
    let objects = 0;
    for (const node of view.nodes) {
      if (node.type === 'group' || node.type === 'mesh-reference') continue;
      const geometry = geometryFor(node);
      if (!geometry) continue;
      const material = new THREE.MeshStandardMaterial({
        color: colorHex(node.material?.color),
        roughness: node.material?.roughness ?? 0.65,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (node.type === 'cylinder') mesh.rotation.x = Math.PI / 2;
      const transform = node.transform || {};
      const position = transform.position || [0, 0, 0];
      mesh.position.set(position[0], position[1], position[2]);
      if (node.type !== 'cylinder') {
        const rotation = transform.rotation || [0, 0, 0];
        mesh.rotation.set(
          THREE.MathUtils.degToRad(rotation[0]),
          THREE.MathUtils.degToRad(rotation[1]),
          THREE.MathUtils.degToRad(rotation[2]),
        );
      }
      mesh.name = node.id;
      content.add(mesh);
      objects += 1;
    }
    boundsRef.current.setFromObject(content);
    applyView(viewAngle);
    onReady?.({ objects, bounds: boundsRef.current.getSize(new THREE.Vector3()).toArray() });
  }, [applyView, modelFormat, modelUrl, onError, onReady, view, viewAngle]);

  React.useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    disposeGroup(overlay);
    if (!measurement) return;
    const material = new THREE.LineBasicMaterial({ color: 0xd29b42 });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...measurement.a),
      new THREE.Vector3(...measurement.b),
    ]);
    overlay.add(new THREE.Line(geometry, material));
    const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xd29b42 });
    for (const point of [measurement.a, measurement.b]) {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), pointMaterial.clone());
      sphere.position.set(...point);
      overlay.add(sphere);
    }
  }, [measurement]);

  React.useEffect(() => {
    applyView(viewAngle);
  }, [applyView, viewAngle]);

  return <div ref={hostRef} className="model3d-canvas-host" data-testid="model3d-scene" />;
}

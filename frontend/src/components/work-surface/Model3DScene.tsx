import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { Scene3DLight, Scene3DView, Scene3DViewNode } from '@/lib/scene3d';
import { meshFormatForPath, type MeshInputFormat } from '@/lib/meshAssets';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';

export type Model3DViewAngle = 'iso' | 'front' | 'top' | 'side' | 'camera';

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

function loadMeshObject(format: MeshInputFormat, url: string, resourcePath = ''): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    if (format === 'stl') {
      new STLLoader().load(url, (geometry) => {
        geometry.computeVertexNormals();
        resolve(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8aa3b8, roughness: 0.62 })));
      }, undefined, reject);
      return;
    }
    if (format === 'obj') {
      new OBJLoader().load(url, resolve, undefined, reject);
      return;
    }
    const loader = new GLTFLoader();
    // 多文件 .gltf 的外部 .bin/贴图走同一个工作区文件路由：Three 的 resolveURL 对相对
    // 资源是字符串拼接，故基址带上 ?path=<目录>/，不另立第二份静态文件服务。
    if (resourcePath) loader.setResourcePath(resourcePath);
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

function countMeshes(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

function hexColor(value: string | undefined, fallback: number): number {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? Number.parseInt(String(value).slice(1), 16) : fallback;
}

/**
 * BLOCK-322 P2-02 — 声明灯到 Three.js 的同参数映射。
 * 灯种/颜色/位置/目标两侧一致；亮度各按自家单位标定（Blender Watts vs Three 无单位强度），
 * 不宣称像素级一致。spot 锥角取声明张角一半（与 Blender spot_size 同义）。
 */
function buildDeclaredLight(light: Scene3DLight): THREE.Object3D {
  const color = hexColor(light.color, 0xffffff);
  const [px, py, pz] = light.position;
  const [tx, ty, tz] = light.target || [0, 0, 0];
  if (light.kind === 'sun') {
    const key = new THREE.DirectionalLight(color, light.energy);
    key.position.set(px, py, pz);
    key.target.position.set(tx, ty, tz);
    return key;
  }
  if (light.kind === 'point') {
    const point = new THREE.PointLight(color, light.energy);
    point.position.set(px, py, pz);
    return point;
  }
  if (light.kind === 'spot') {
    const spot = new THREE.SpotLight(color, light.energy, 0, THREE.MathUtils.degToRad((light.spotDeg ?? 40) / 2));
    spot.position.set(px, py, pz);
    spot.target.position.set(tx, ty, tz);
    return spot;
  }
  RectAreaLightUniformsLib.init();
  const side = light.size && light.size > 0 ? light.size : 100;
  const area = new THREE.RectAreaLight(color, light.energy, side, side);
  area.position.set(px, py, pz);
  area.lookAt(tx, ty, tz);
  return area;
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
  projectId = null,
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
  modelFormat?: MeshInputFormat;
  projectId?: string | null;
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
  const lightsRef = React.useRef<THREE.Group | null>(null);
  const boundsRef = React.useRef(new THREE.Box3());

  const applyView = React.useCallback((angle: Model3DViewAngle) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const declared = view?.scene.camera;
    if (angle === 'camera') {
      // 未声明机位即不动相机——不拿等轴取景冒充「声明机位」。
      if (!declared?.position || !declared?.target) return;
      const [tx, ty, tz] = declared.target;
      if (typeof declared.fovDeg === 'number') camera.fov = declared.fovDeg;
      camera.up.fromArray(declared.up ?? [0, 0, 1]);
      camera.position.fromArray(declared.position);
      camera.lookAt(new THREE.Vector3(tx, ty, tz));
      camera.updateProjectionMatrix();
      controls.target.set(tx, ty, tz);
      controls.update();
      return;
    }
    const box = boundsRef.current;
    const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(100, 80, 60) : box.getSize(new THREE.Vector3());
    const distance = Math.max(40, Math.max(size.x, size.y, size.z) * 2.2);
    const positions: Record<Exclude<Model3DViewAngle, 'camera'>, THREE.Vector3> = {
      iso: new THREE.Vector3(center.x + distance * 0.8, center.y - distance * 0.8, center.z + distance * 0.65),
      front: new THREE.Vector3(center.x, center.y - distance, center.z),
      top: new THREE.Vector3(center.x, center.y, center.z + distance),
      side: new THREE.Vector3(center.x + distance, center.y, center.z),
    };
    camera.up.set(0, 0, 1);
    camera.position.copy(positions[angle]);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  }, [view]);

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
    // 灯组不在这里建：默认摄影棚灯与声明灯互斥，统一由下方灯光同步 effect 按声明重建，
    // 避免「拿默认光冒充声明光」。
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

  // BLOCK-322 P2-02 — 灯组同步：声明灯存在即整体替换默认摄影棚灯（不拿默认光冒充声明光），
  // environment 声明映射为环境光 + 场景背景；未声明时保持既有默认灯组与透明背景。
  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    if (lightsRef.current) {
      scene.remove(lightsRef.current);
      lightsRef.current.clear();
    }
    const group = new THREE.Group();
    const declared = view?.scene.lights || [];
    if (declared.length === 0) {
      group.add(new THREE.HemisphereLight(0xffffff, 0x203040, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.1);
      key.position.set(120, -180, 220);
      group.add(key);
    } else {
      for (const light of declared) {
        const object = buildDeclaredLight(light);
        group.add(object);
        const target = (object as unknown as { target?: THREE.Object3D }).target;
        if (target) group.add(target);
      }
    }
    const environment = view?.scene.environment;
    if (environment) {
      const background = hexColor(environment.background, 0xffffff);
      const strength = environment.worldStrength ?? 1;
      if (strength > 0) group.add(new THREE.AmbientLight(background, strength));
      scene.background = environment.background ? new THREE.Color(background) : null;
    } else {
      scene.background = null;
    }
    scene.add(group);
    lightsRef.current = group;
    return undefined;
  }, [view]);

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
      // 递归命中：导入资产是嵌套层级，命中叶子后回溯到 content 直接子级（其 name = 节点 id）。
      const hit = raycaster.intersectObjects(content.children, true)[0];
      let picked: THREE.Object3D | null = hit ? hit.object : null;
      while (picked && picked.parent && picked.parent !== content) picked = picked.parent;
      const nodeId = picked ? (picked.name || null) : null;
      if (measureMode && onMeasurePoint) {
        if (hit) onMeasurePoint([hit.point.x, hit.point.y, hit.point.z]);
        return;
      }
      onSelectNode?.(nodeId);
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
    if (!content) return undefined;
    let cancelled = false;
    disposeGroup(content);
    boundsRef.current = new THREE.Box3();

    const report = (objects: number) => {
      if (cancelled) return;
      boundsRef.current.setFromObject(content);
      applyView(viewAngle);
      onReady?.({ objects, bounds: boundsRef.current.getSize(new THREE.Vector3()).toArray() });
    };
    const fail = (message: string) => {
      if (!cancelled) onError?.(message);
    };

    if (modelUrl) {
      void loadMeshObject(modelFormat, modelUrl).then((object) => {
        if (cancelled) return;
        object.name = `imported-${modelFormat}`;
        content.add(object);
        report(object.children.length > 0 ? object.children.length : 1);
      }, () => fail(`${modelFormat}_load_failed`));
      return () => { cancelled = true; };
    }
    if (!view) return undefined;

    let objects = 0;
    const pending: Array<Promise<void>> = [];
    for (const node of view.nodes) {
      if (node.type === 'group') continue;
      if (node.type === 'mesh-reference') {
        const sourcePath = String(node.source?.path || '');
        const format = meshFormatForPath(sourcePath);
        if (!format) {
          fail(`mesh_reference_invalid:${node.id}（source.path=${sourcePath || '—'}）`);
          continue;
        }
        if (!projectId) {
          fail(`mesh_reference_unavailable:${node.id} 需要已打开的项目工作区才能从工作区文件加载。`);
          continue;
        }
        const directory = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
        pending.push(loadMeshObject(
          format,
          workspaceFileUrlFor(projectId, sourcePath),
          workspaceFileUrlFor(projectId, directory),
        ).then((object) => {
          if (cancelled) return;
          object.name = node.id;
          const transform = node.transform || {};
          const position = transform.position || [0, 0, 0];
          const rotation = transform.rotation || [0, 0, 0];
          object.position.set(position[0], position[1], position[2]);
          object.rotation.set(
            THREE.MathUtils.degToRad(rotation[0]),
            THREE.MathUtils.degToRad(rotation[1]),
            THREE.MathUtils.degToRad(rotation[2]),
          );
          content.add(object);
          objects += countMeshes(object) || 1;
        }, () => fail(`mesh_reference_load_failed:${node.id}（${sourcePath}）`)));
        continue;
      }
      const geometry = geometryFor(node);
      if (!geometry) continue;
      const material = new THREE.MeshStandardMaterial({
        color: colorHex(node.material?.color),
        roughness: node.material?.roughness ?? 0.65,
        // BLOCK-322 P2-03 — 未声明 metallic 时保持 0.05 的存量观感；声明后按 SceneSpec 值走。
        metalness: node.material?.metallic ?? 0.05,
      });
      if (node.material?.emissive) {
        material.emissive = new THREE.Color(hexColor(node.material.emissive, 0x000000));
      }
      const textureSpec = node.material?.baseColorTexture;
      const texturePath = textureSpec?.path;
      if (texturePath) {
        if (!projectId) {
          fail(`texture_reference_unavailable:${node.id} 需要已打开的项目工作区才能从工作区文件加载贴图。`);
        } else {
          pending.push(new Promise<void>((done) => {
            new THREE.TextureLoader().load(
              workspaceFileUrlFor(projectId, texturePath),
              (texture) => {
                if (cancelled) {
                  texture.dispose();
                } else {
                  texture.colorSpace = THREE.SRGBColorSpace;
                  material.map = texture;
                  material.needsUpdate = true;
                }
                done();
              },
              undefined,
              () => {
                fail(`texture_reference_load_failed:${node.id}（${texturePath}）`);
                done();
              },
            );
          }));
        }
      }
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
    report(objects);
    if (pending.length > 0) {
      void Promise.allSettled(pending).then(() => report(objects));
    }
    return () => { cancelled = true; };
  }, [applyView, modelFormat, modelUrl, onError, onReady, projectId, view, viewAngle]);

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

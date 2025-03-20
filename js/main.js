import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ColladaExporter } from 'three/addons/exporters/ColladaExporter.js';

let scene, camera, renderer, controls, transformControls, selectedBone = null, currentModel;
const boneDots = [], boneLines = [];

init();
animate();

function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Transform controls
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
    });

    // Model selection
    const modelSelect = document.getElementById('modelSelect');
    modelSelect.addEventListener('change', loadModel);
    loadModel(); // Load initial model

    // Button events
    document.getElementById('saveBVH').addEventListener('click', exportToBVH);
    document.getElementById('saveDA Purchase').addEventListener('click', exportToDAE);

    // Raycaster for clicking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('click', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(boneDots);
        if (intersects.length > 0) {
            selectBone(intersects[0].object.userData.bone);
        }
    });

    // Keyboard controls
    window.addEventListener('keydown', (event) => {
        if (!selectedBone && event.key.toLowerCase() !== 'b') return;
        switch (event.key.toLowerCase()) {
            case 'r':
                transformControls.setMode('rotate');
                break;
            case 's':
                transformControls.setMode('scale');
                break;
            case 't':
                transformControls.setMode('translate');
                break;
            case 'b':
                exportToBVH();
                break;
        }
    });

    // Resize handler
    window.addEventListener('resize', onWindowResize);
}

function loadModel() {
    // Clear previous model
    if (currentModel) {
        scene.remove(currentModel);
        boneDots.length = 0;
        boneLines.forEach(line => scene.remove(line));
        boneLines.length = 0;
    }

    const loader = new ColladaLoader();
    const url = document.getElementById('modelSelect').value;
    loader.load(url, (collada) => {
        currentModel = collada.scene;
        currentModel.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x808080,
                    transparent: true,
                    opacity: 0.5
                });
            }
            if (child.isSkinnedMesh) {
                visualizeSkeleton(child);
            }
        });
        scene.add(currentModel);
    }, undefined, (error) => {
        console.error('Error loading Collada model:', error);
    });
}

function visualizeSkeleton(skinnedMesh) {
    const bones = skinnedMesh.skeleton.bones;
    bones.forEach((bone) => {
        const dotGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const dot = new THREE.Mesh(dotGeometry, dotMaterial);
        dot.position.copy(bone.position);
        dot.userData.bone = bone;
        scene.add(dot);
        boneDots.push(dot);

        if (bone.parent && bone.parent.isBone) {
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                bone.position,
                bone.parent.position
            ]);
            const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            scene.add(line);
            boneLines.push(line);
        }
    });
}

function selectBone(bone) {
    if (selectedBone) {
        boneDots.find(dot => dot.userData.bone === selectedBone).material.color.set(0xffffff);
    }
    selectedBone = bone;
    boneDots.find(dot => dot.userData.bone === bone).material.color.set(0x00ff00);
    transformControls.attach(bone);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);

    boneDots.forEach(dot => dot.position.copy(dot.userData.bone.getWorldPosition(new THREE.Vector3())));
    boneLines.forEach(line => {
        const bone = line.parent;
        const parentBone = bone.parent;
        if (parentBone && parentBone.isBone) {
            const positions = line.geometry.attributes.position.array;
            const bonePos = bone.getWorldPosition(new THREE.Vector3());
            const parentPos = parentBone.getWorldPosition(new THREE.Vector3());
            positions[0] = bonePos.x;
            positions[1] = bonePos.y;
            positions[2] = bonePos.z;
            positions[3] = parentPos.x;
            positions[4] = parentPos.y;
            positions[5] = parentPos.z;
            line.geometry.attributes.position.needsUpdate = true;
        }
    });
}

function exportToBVH() {
    const bones = boneDots.map(dot => dot.userData.bone);
    if (bones.length === 0) return;

    let bvhString = "HIERARCHY\n";
    const rootBone = bones.find(bone => !bone.parent || !bone.parent.isBone) || bones[0];
    bvhString += buildBVHHierarchy(rootBone, 0);

    bvhString += "MOTION\n";
    bvhString += "Frames: 1\n";
    bvhString += "Frame Time: 0.033333\n";
    bvhString += buildBVHMotion(bones);

    const blob = new Blob([bvhString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'animation.bvh';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function buildBVHHierarchy(bone, level) {
    const indent = "  ".repeat(level);
    let str = `${indent}JOINT ${bone.name || `Bone_${bone.id}`}\n`;
    str += `${indent}{\n`;
    str += `${indent}  OFFSET ${bone.position.x.toFixed(6)} ${bone.position.y.toFixed(6)} ${bone.position.z.toFixed(6)}\n`;
    str += `${indent}  CHANNELS 6 Xposition Yposition Zposition Xrotation Yrotation Zrotation\n`;

    const children = bone.children.filter(child => child.isBone);
    if (children.length > 0) {
        children.forEach(child => {
            str += buildBVHHierarchy(child, level + 1);
        });
    } else {
        str += `${indent}  End Site\n`;
        str += `${indent}  {\n`;
        str += `${indent}    OFFSET 0.0 0.0 0.0\n`;
        str += `${indent}  }\n`;
    }
    str += `${indent}}\n`;
    return str.replace("HIERARCHY\nJOINT", "HIERARCHY\nROOT");
}

function buildBVHMotion(bones) {
    let motion = "";
    bones.forEach(bone => {
        const pos = bone.position;
        const rot = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
        const posValues = `${pos.x.toFixed(6)} ${pos.y.toFixed(6)} ${pos.z.toFixed(6)}`;
        const rotValues = `${THREE.MathUtils.radToDeg(rot.x).toFixed(6)} ${THREE.MathUtils.radToDeg(rot.y).toFixed(6)} ${THREE.MathUtils.radToDeg(rot.z).toFixed(6)}`;
        motion += `${posValues} ${rotValues} `;
    });
    return motion.trim() + "\n";
}

function exportToDAE() {
    const exporter = new ColladaExporter();
    const result = exporter.parse(currentModel);
    const blob = new Blob([result.data], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'deformed_model.dae';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

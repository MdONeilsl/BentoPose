import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

let scene, camera, renderer, controls, transformControls, selectedBone = null;
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
    scene.add(transformControls);

    // Load Collada model
    const loader = new ColladaLoader();
    loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/collada/elf/elf.dae', (collada) => {
        const model = collada.scene;
        model.traverse((child) => {
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
        scene.add(model);
    });

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
            case 'b': // Export to BVH
                exportToBVH();
                break;
        }
    });

    // Resize handler
    window.addEventListener('resize', onWindowResize);
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

    boneDots.forEach(dot => dot.position.copy(dot.userData.bone.worldPosition()));
    boneLines.forEach(line => {
        const positions = line.geometry.attributes.position.array;
        const bone = line.parent;
        const parentBone = bone.parent;
        if (parentBone && parentBone.isBone) {
            positions[0] = bone.worldPosition().x;
            positions[1] = bone.worldPosition().y;
            positions[2] = bone.worldPosition().z;
            positions[3] = parentBone.worldPosition().x;
            positions[4] = parentBone.worldPosition().y;
            positions[5] = parentBone.worldPosition().z;
            line.geometry.attributes.position.needsUpdate = true;
        }
    });
}

// BVH Export Function
function exportToBVH() {
    const bones = boneDots.map(dot => dot.userData.bone);
    if (bones.length === 0) return;

    let bvhString = "HIERARCHY\n";
    const rootBone = bones.find(bone => !bone.parent || !bone.parent.isBone) || bones[0];
    bvhString += buildBVHHierarchy(rootBone, 0);

    // Motion section (single frame for now)
    bvhString += "MOTION\n";
    bvhString += "Frames: 1\n";
    bvhString += "Frame Time: 0.033333\n"; // ~30 FPS
    bvhString += buildBVHMotion(bones);

    // Trigger file download
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
    return str;
}

function buildBVHMotion(bones) {
    let motion = "";
    bones.forEach(bone => {
        const pos = bone.position; // Local position
        const rot = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ'); // Convert to Euler angles
        const posValues = `${pos.x.toFixed(6)} ${pos.y.toFixed(6)} ${pos.z.toFixed(6)}`;
        const rotValues = `${THREE.MathUtils.radToDeg(rot.x).toFixed(6)} ${THREE.MathUtils.radToDeg(rot.y).toFixed(6)} ${THREE.MathUtils.radToDeg(rot.z).toFixed(6)}`;
        motion += `${posValues} ${rotValues} `;
    });
    return motion.trim() + "\n";
}

// Replace 'JOINT' with 'ROOT' for the first bone
function fixRootBone(bvhString) {
    return bvhString.replace("HIERARCHY\nJOINT", "HIERARCHY\nROOT");
}

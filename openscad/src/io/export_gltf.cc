#include "io/export.h"
#include "geometry/Geometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetUtils.h"
#include "utils/printutils.h"
#include "json/json.hpp"
#include "Feature.h"
#include "glview/ColorMap.h"
#include <ostream>
#include <map>
#include <vector>
#include <cfloat>
#include <cstring>
#include <algorithm>

using json = nlohmann::json;

static std::string base64_encode(const unsigned char* data, size_t len) {
    static const char chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string ret;
    ret.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t val = (data[i] << 16) | (i + 1 < len ? data[i + 1] << 8 : 0) | (i + 2 < len ? data[i + 2] : 0);
        ret.push_back(chars[(val >> 18) & 0x3F]);
        ret.push_back(chars[(val >> 12) & 0x3F]);
        ret.push_back(i + 1 < len ? chars[(val >> 6) & 0x3F] : '=');
        ret.push_back(i + 2 < len ? chars[val & 0x3F] : '=');
    }
    return ret;
}

void export_gltf(const std::shared_ptr<const Geometry>& geom, std::ostream& output, bool is_glb, const ExportInfo& exportInfo)
{
    std::vector<std::shared_ptr<const PolySet>> polysets;

    if (auto geomList = std::dynamic_pointer_cast<const GeometryList>(geom)) {
        for (const auto& item : geomList->flatten()) {
            auto ps = PolySetUtils::getGeometryAsPolySet(item.second);
            if (ps && !ps->vertices.empty()) {
                if (Feature::ExperimentalPredictibleOutput.is_enabled()) {
                    ps = createSortedPolySet(*ps);
                }
                polysets.push_back(ps);
            }
        }
    } else {
        auto ps = PolySetUtils::getGeometryAsPolySet(geom);
        if (ps && !ps->vertices.empty()) {
            if (Feature::ExperimentalPredictibleOutput.is_enabled()) {
                ps = createSortedPolySet(*ps);
            }
            polysets.push_back(ps);
        }
    }

    if (polysets.empty()) return;

    struct PrimitiveInfo {
        int color_idx;
        std::vector<uint32_t> indices;
        std::shared_ptr<const PolySet> ps;
    };

    struct MeshInfo {
        std::vector<float> positions;
        float min_pos[3];
        float max_pos[3];
        std::vector<PrimitiveInfo> primitives;
        std::shared_ptr<const PolySet> ps;
    };

    std::vector<MeshInfo> meshes_info;

    for (const auto& ps : polysets) {
        MeshInfo minfo;
        minfo.ps = ps;
        for(int i = 0; i < 3; ++i) {
            minfo.min_pos[i] = FLT_MAX;
            minfo.max_pos[i] = -FLT_MAX;
        }

        for (const auto& v : ps->vertices) {
            // OpenSCAD uses a right-handed Z-up coordinate system (where +X is right, +Y is back, and +Z is up),
            // while glTF standardly requires a right-handed Y-up coordinate system (where +X is right, +Y is up, and +Z is forward/outwards toward the viewer).
            float pt[3] = {(float)v[0], (float)v[2], -(float)v[1]};
            minfo.positions.push_back(pt[0]);
            minfo.positions.push_back(pt[1]);
            minfo.positions.push_back(pt[2]);
            for(int i = 0; i < 3; ++i) {
                minfo.min_pos[i] = std::min(minfo.min_pos[i], pt[i]);
                minfo.max_pos[i] = std::max(minfo.max_pos[i], pt[i]);
            }
        }

        std::map<int, PrimitiveInfo> prim_map;
        for (size_t i = 0; i < ps->indices.size(); ++i) {
            int color_idx = ps->color_indices.empty() ? -1 : ps->color_indices[i];
            auto& prim = prim_map[color_idx];
            prim.color_idx = color_idx;
            const auto& face = ps->indices[i];
            if (face.size() < 3) continue;
            for (size_t j = 1; j + 1 < face.size(); ++j) {
                prim.indices.push_back(face[0]);
                prim.indices.push_back(face[j]);
                prim.indices.push_back(face[j + 1]);
            }
        }

        for (auto& kv : prim_map) {
            if (!kv.second.indices.empty()) {
                kv.second.ps = ps;
                minfo.primitives.push_back(std::move(kv.second));
            }
        }
        
        if (!minfo.primitives.empty()) {
            meshes_info.push_back(std::move(minfo));
        }
    }

    if (meshes_info.empty()) return;

    std::vector<unsigned char> bin_data;
    json meshes_json = json::array();
    json nodes_json = json::array();
    json materials_json = json::array();
    json accessors = json::array();
    json bufferViews = json::array();
    std::vector<int> scene_nodes;

    bool use_clearcoat = false;
    bool use_sheen = false;
    bool use_transmission = false;
    bool use_thickness = false;

    for (const auto& minfo : meshes_info) {
        size_t pos_offset = bin_data.size();
        size_t pos_length = minfo.positions.size() * sizeof(float);
        bin_data.resize(pos_offset + pos_length);
        memcpy(bin_data.data() + pos_offset, minfo.positions.data(), pos_length);

        int pos_bufferView_idx = bufferViews.size();
        bufferViews.push_back({
            {"buffer", 0}, {"byteOffset", pos_offset}, {"byteLength", pos_length}, {"target", 34962}
        });

        int pos_accessor_idx = accessors.size();
        accessors.push_back({
            {"bufferView", pos_bufferView_idx}, {"byteOffset", 0}, {"componentType", 5126}, {"count", minfo.ps->vertices.size()},
            {"type", "VEC3"}, {"min", {minfo.min_pos[0], minfo.min_pos[1], minfo.min_pos[2]}}, {"max", {minfo.max_pos[0], minfo.max_pos[1], minfo.max_pos[2]}}
        });

        json primitives_json = json::array();

        for (const auto& prim : minfo.primitives) {
            size_t idx_offset = bin_data.size();
            size_t idx_length = prim.indices.size() * sizeof(uint32_t);
            bin_data.resize(idx_offset + idx_length);
            memcpy(bin_data.data() + idx_offset, prim.indices.data(), idx_length);

            int idx_bufferView_idx = bufferViews.size();
            bufferViews.push_back({
                {"buffer", 0}, {"byteOffset", idx_offset}, {"byteLength", idx_length}, {"target", 34963}
            });

            int idx_accessor_idx = accessors.size();
            accessors.push_back({
                {"bufferView", idx_bufferView_idx}, {"byteOffset", 0}, {"componentType", 5125}, {"count", prim.indices.size()}, {"type", "SCALAR"}
            });

            int mat_idx = materials_json.size();
            json mat = {{"pbrMetallicRoughness", json::object()}};
            auto ps = prim.ps;

            if (prim.color_idx >= 0 && prim.color_idx < (int)ps->colors.size()) {
                auto color = ps->colors[prim.color_idx];
                int r = 255, g = 255, b = 0, a = 255;
                color.getRgba(r, g, b, a);
                mat["pbrMetallicRoughness"]["baseColorFactor"] = {r/255.0f, g/255.0f, b/255.0f, a/255.0f};

                float roughness = ps->roughnesses.empty() ? 0.0f : ps->roughnesses[prim.color_idx];
                float metalness = ps->metalnesses.empty() ? 0.0f : ps->metalnesses[prim.color_idx];
                mat["pbrMetallicRoughness"]["roughnessFactor"] = roughness;
                mat["pbrMetallicRoughness"]["metallicFactor"] = metalness;

                float clearcoat = ps->clearcoats.empty() ? 0.0f : ps->clearcoats[prim.color_idx];
                float clearcoatRoughness = ps->clearcoatRoughnesses.empty() ? 0.0f : ps->clearcoatRoughnesses[prim.color_idx];
                if (clearcoat > 0.0f) {
                    mat["extensions"]["KHR_materials_clearcoat"] = {
                        {"clearcoatFactor", clearcoat},
                        {"clearcoatRoughnessFactor", clearcoatRoughness}
                    };
                    use_clearcoat = true;
                }

                float sheen = ps->sheens.empty() ? 0.0f : ps->sheens[prim.color_idx];
                if (sheen > 0.0f) {
                    Color4f sheenColor;
                    if (ps->sheenColors.empty()) {
                        Vector4f v; v[0]=0; v[1]=0; v[2]=0; v[3]=1;
                        sheenColor = v;
                    } else {
                        sheenColor = ps->sheenColors[prim.color_idx];
                    }
                    float sheenRoughness = ps->sheenRoughnesses.empty() ? 0.0f : ps->sheenRoughnesses[prim.color_idx];

                    mat["extensions"]["KHR_materials_sheen"] = {
                        {"sheenColorFactor", {sheen * sheenColor.r(), sheen * sheenColor.g(), sheen * sheenColor.b()}},
                        {"sheenRoughnessFactor", sheenRoughness}
                    };
                    use_sheen = true;
                }

                float transmission = ps->transmissions.empty() ? 0.0f : ps->transmissions[prim.color_idx];
                if (transmission > 0.0f) {
                    mat["extensions"]["KHR_materials_transmission"] = {
                        {"transmissionFactor", transmission}
                    };
                    use_transmission = true;
                }

                float thickness = ps->thicknesses.empty() ? 0.0f : ps->thicknesses[prim.color_idx];
                if (thickness > 0.0f) {
                    mat["extensions"]["KHR_materials_volume"] = {
                        {"thicknessFactor", thickness}
                    };
                    use_thickness = true;
                }

                if (a < 255) mat["alphaMode"] = "BLEND";
            } else {
                float r = exportInfo.defaultColor.r(); float g = exportInfo.defaultColor.g();
                float b = exportInfo.defaultColor.b(); float a = exportInfo.defaultColor.a();
                mat["pbrMetallicRoughness"]["baseColorFactor"] = {r, g, b, a};
                mat["pbrMetallicRoughness"]["roughnessFactor"] = 0.5f;
                mat["pbrMetallicRoughness"]["metallicFactor"] = 0.0f;
                if (a < 1.0f) mat["alphaMode"] = "BLEND";
            }
            mat["doubleSided"] = true;
            materials_json.push_back(mat);

            primitives_json.push_back({ {"attributes", {{"POSITION", pos_accessor_idx}}}, {"indices", idx_accessor_idx}, {"material", mat_idx} });
        }

        int mesh_idx = meshes_json.size();
        meshes_json.push_back({ {"primitives", primitives_json} });

        int node_idx = nodes_json.size();
        nodes_json.push_back({ {"mesh", mesh_idx} });
        scene_nodes.push_back(node_idx);
    }

    json j;
    j["asset"] = {{"version", "2.0"}, {"generator", EXPORT_CREATOR}};
    j["scene"] = 0;
    j["scenes"] = {{ {"nodes", scene_nodes} }};
    j["nodes"] = nodes_json;
    j["meshes"] = meshes_json;
    j["materials"] = materials_json;
    j["accessors"] = accessors;
    j["bufferViews"] = bufferViews;

    std::vector<std::string> extensionsUsed;
    if (use_clearcoat) extensionsUsed.push_back("KHR_materials_clearcoat");
    if (use_sheen) extensionsUsed.push_back("KHR_materials_sheen");
    if (use_transmission) extensionsUsed.push_back("KHR_materials_transmission");
    if (use_thickness) extensionsUsed.push_back("KHR_materials_volume");

    if (!extensionsUsed.empty()) {
        j["extensionsUsed"] = extensionsUsed;
    }
    if (is_glb) {
        while (bin_data.size() % 4 != 0) bin_data.push_back(0x00);
        j["buffers"] = {{ {"byteLength", bin_data.size()} }};
        std::string json_str = j.dump();
        while (json_str.size() % 4 != 0) json_str.push_back(' ');

        uint32_t magic = 0x46546C67; uint32_t version = 2;
        uint32_t length = 12 + 8 + json_str.size() + 8 + bin_data.size();
        output.write((const char*)&magic, 4); output.write((const char*)&version, 4); output.write((const char*)&length, 4);
        uint32_t json_chunk_length = json_str.size(); uint32_t json_chunk_type = 0x4E4F534A;
        output.write((const char*)&json_chunk_length, 4); output.write((const char*)&json_chunk_type, 4); output.write(json_str.data(), json_str.size());
        uint32_t bin_chunk_length = bin_data.size(); uint32_t bin_chunk_type = 0x004E4942;
        output.write((const char*)&bin_chunk_length, 4); output.write((const char*)&bin_chunk_type, 4); output.write((const char*)bin_data.data(), bin_data.size());
    } else {
        j["buffers"] = {{ {"byteLength", bin_data.size()}, {"uri", "data:application/octet-stream;base64," + base64_encode(bin_data.data(), bin_data.size())} }};
        output << j.dump(2);
    }
}

import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

class PipeBuoyancyCalculator:
    def __init__(self, root):
        self.root = root
        self.root.title("HDPE Pipe Buoyancy Calculator")
        self.root.geometry("900x700")
        
        # Constants
        self.WATER_DENSITY = 1000  # kg/m³
        self.HDPE_DENSITY = 950    # kg/m³
        self.GRAVITY = 9.81        # m/s²
        
        # Variables
        self.sections = []
        self.pipe_od = tk.DoubleVar(value=32.0)  # mm
        self.pipe_thickness = tk.DoubleVar(value=3.0)  # mm
        self.safety_factor_threshold = tk.DoubleVar(value=1.5)
        
        # Create UI
        self.create_ui()
        
    def create_ui(self):
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Left panel (inputs)
        left_panel = ttk.Frame(main_frame)
        left_panel.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # Right panel (results and visualization)
        right_panel = ttk.Frame(main_frame)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)
        
        # Pipe specifications frame
        pipe_frame = ttk.LabelFrame(left_panel, text="Pipe Specifications", padding="10")
        pipe_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(pipe_frame, text="Outer Diameter (mm):").grid(row=0, column=0, sticky=tk.W)
        ttk.Entry(pipe_frame, textvariable=self.pipe_od, width=10).grid(row=0, column=1, padx=5, pady=2)
        
        ttk.Label(pipe_frame, text="Wall Thickness (mm):").grid(row=1, column=0, sticky=tk.W)
        ttk.Entry(pipe_frame, textvariable=self.pipe_thickness, width=10).grid(row=1, column=1, padx=5, pady=2)
        
        ttk.Label(pipe_frame, text="Safety Factor Threshold:").grid(row=2, column=0, sticky=tk.W)
        ttk.Entry(pipe_frame, textvariable=self.safety_factor_threshold, width=10).grid(row=2, column=1, padx=5, pady=2)
        
        # Section input frame
        section_frame = ttk.LabelFrame(left_panel, text="Pipeline Sections", padding="10")
        section_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Section input fields
        section_input_frame = ttk.Frame(section_frame)
        section_input_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(section_input_frame, text="Section Name:").grid(row=0, column=0, sticky=tk.W)
        self.section_name_var = tk.StringVar()
        ttk.Entry(section_input_frame, textvariable=self.section_name_var, width=10).grid(row=0, column=1, padx=5, pady=2)
        
        ttk.Label(section_input_frame, text="Distance (m):").grid(row=1, column=0, sticky=tk.W)
        self.section_distance_var = tk.DoubleVar()
        ttk.Entry(section_input_frame, textvariable=self.section_distance_var, width=10).grid(row=1, column=1, padx=5, pady=2)
        
        ttk.Label(section_input_frame, text="Number of Pipes:").grid(row=2, column=0, sticky=tk.W)
        self.num_pipes_var = tk.IntVar(value=1)
        ttk.Entry(section_input_frame, textvariable=self.num_pipes_var, width=10).grid(row=2, column=1, padx=5, pady=2)
        
        ttk.Label(section_input_frame, text="Block Weight (kg):").grid(row=3, column=0, sticky=tk.W)
        self.block_weight_var = tk.DoubleVar()
        ttk.Entry(section_input_frame, textvariable=self.block_weight_var, width=10).grid(row=3, column=1, padx=5, pady=2)
        
        ttk.Label(section_input_frame, text="Distance Between Blocks (m):").grid(row=4, column=0, sticky=tk.W)
        self.block_spacing_var = tk.DoubleVar()
        ttk.Entry(section_input_frame, textvariable=self.block_spacing_var, width=10).grid(row=4, column=1, padx=5, pady=2)
        
        # Buttons for section management
        button_frame = ttk.Frame(section_frame)
        button_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Button(button_frame, text="Add Section", command=self.add_section).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Remove Selected", command=self.remove_section).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Calculate", command=self.calculate).pack(side=tk.LEFT, padx=5)
        
        # Section list
        list_frame = ttk.Frame(section_frame)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.section_list = ttk.Treeview(list_frame, columns=("name", "distance", "pipes", "block_weight", "block_spacing"),
                                         show="headings", height=10)
        self.section_list.heading("name", text="Name")
        self.section_list.heading("distance", text="Distance (m)")
        self.section_list.heading("pipes", text="Pipes")
        self.section_list.heading("block_weight", text="Block (kg)")
        self.section_list.heading("block_spacing", text="Spacing (m)")
        
        self.section_list.column("name", width=80)
        self.section_list.column("distance", width=80)
        self.section_list.column("pipes", width=50)
        self.section_list.column("block_weight", width=80)
        self.section_list.column("block_spacing", width=80)
        
        self.section_list.pack(fill=tk.BOTH, expand=True)
        
        # Results frame
        results_frame = ttk.LabelFrame(right_panel, text="Results", padding="10")
        results_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.total_weight_var = tk.StringVar(value="Total Weight: 0 kg")
        ttk.Label(results_frame, textvariable=self.total_weight_var).pack(anchor=tk.W)
        
        self.total_buoyancy_var = tk.StringVar(value="Total Buoyancy: 0 N")
        ttk.Label(results_frame, textvariable=self.total_buoyancy_var).pack(anchor=tk.W)
        
        self.safety_factor_var = tk.StringVar(value="Safety Factor: 0")
        ttk.Label(results_frame, textvariable=self.safety_factor_var).pack(anchor=tk.W)
        
        self.total_blocks_var = tk.StringVar(value="Total Blocks: 0")
        ttk.Label(results_frame, textvariable=self.total_blocks_var).pack(anchor=tk.W)
        
        # Visualization frame
        viz_frame = ttk.LabelFrame(right_panel, text="Visualization", padding="10")
        viz_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.figure, self.ax = plt.subplots(figsize=(5, 4))
        self.canvas = FigureCanvasTkAgg(self.figure, viz_frame)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
        
    def add_section(self):
        try:
            name = self.section_name_var.get()
            distance = float(self.section_distance_var.get())
            num_pipes = int(self.num_pipes_var.get())
            block_weight = float(self.block_weight_var.get())
            block_spacing = float(self.block_spacing_var.get())
            
            if not name:
                name = f"Section {len(self.sections) + 1}"
            
            if distance <= 0 or num_pipes <= 0 or block_weight <= 0 or block_spacing <= 0:
                messagebox.showerror("Error", "All values must be positive numbers")
                return
            
            section = {
                "name": name,
                "distance": distance,
                "num_pipes": num_pipes,
                "block_weight": block_weight,
                "block_spacing": block_spacing
            }
            
            self.sections.append(section)
            self.section_list.insert("", tk.END, values=(name, distance, num_pipes, block_weight, block_spacing))
            
            # Clear input fields
            self.section_name_var.set("")
            self.section_distance_var.set(0)
            self.block_weight_var.set(0)
            self.block_spacing_var.set(0)
            
        except ValueError:
            messagebox.showerror("Error", "Please enter valid numeric values")
    
    def remove_section(self):
        selected_item = self.section_list.selection()
        if selected_item:
            index = self.section_list.index(selected_item[0])
            self.section_list.delete(selected_item[0])
            self.sections.pop(index)
    
    def calculate_pipe_buoyancy(self, od_mm, thickness_mm):
        # Convert mm to m
        od = od_mm / 1000
        thickness = thickness_mm / 1000
        
        # Calculate inner diameter
        id = od - 2 * thickness
        
        # Calculate volumes
        pipe_volume = np.pi * (od/2)**2 * 1  # For 1m of pipe
        air_volume = np.pi * (id/2)**2 * 1  # For 1m of pipe
        material_volume = pipe_volume - air_volume
        
        # Calculate weights
        pipe_weight = material_volume * self.HDPE_DENSITY  # kg
        buoyancy_force = pipe_volume * self.WATER_DENSITY * self.GRAVITY  # N
        pipe_weight_force = pipe_weight * self.GRAVITY  # N
        
        # Net buoyancy (positive means it floats)
        net_buoyancy = buoyancy_force - pipe_weight_force  # N
        
        return pipe_weight, net_buoyancy
    
    def calculate(self):
        if not self.sections:
            messagebox.showerror("Error", "Please add at least one section")
            return
        
        od = self.pipe_od.get()
        thickness = self.pipe_thickness.get()
        
        pipe_weight_per_m, buoyancy_per_m = self.calculate_pipe_buoyancy(od, thickness)
        
        total_length = 0
        total_buoyancy_force = 0
        total_weight_force = 0
        total_blocks = 0
        blocks_by_type = {}
        safety_by_section = []
        
        # For visualization
        section_names = []
        section_safety_factors = []
        
        for section in self.sections:
            distance = section["distance"]
            num_pipes = section["num_pipes"]
            block_weight = section["block_weight"]
            block_spacing = section["block_spacing"]
            name = section["name"]
            
            # Calculate number of blocks in this section
            num_blocks = np.ceil(distance / block_spacing)
            total_blocks += num_blocks
            
            # Track blocks by type
            block_key = f"{block_weight}kg"
            if block_key in blocks_by_type:
                blocks_by_type[block_key] += num_blocks
            else:
                blocks_by_type[block_key] = num_blocks
            
            # Calculate forces in this section
            section_buoyancy = buoyancy_per_m * distance * num_pipes
            section_pipe_weight = pipe_weight_per_m * distance * num_pipes * self.GRAVITY
            section_block_weight = block_weight * num_blocks * self.GRAVITY
            
            # Net effect
            net_force = section_buoyancy - section_pipe_weight - section_block_weight
            
            # Safety factor
            if section_buoyancy > 0:
                safety_factor = (section_pipe_weight + section_block_weight) / section_buoyancy
            else:
                safety_factor = float('inf')  # No buoyancy, always safe
            
            safety_by_section.append({
                "name": name,
                "safety_factor": safety_factor,
                "buoyancy": section_buoyancy,
                "pipe_weight": section_pipe_weight,
                "block_weight": section_block_weight,
                "net_force": net_force
            })
            
            section_names.append(name)
            section_safety_factors.append(safety_factor)
            
            total_length += distance
            total_buoyancy_force += section_buoyancy
            total_weight_force += section_pipe_weight + section_block_weight
        
        # Overall safety factor
        overall_safety = total_weight_force / total_buoyancy_force if total_buoyancy_force > 0 else float('inf')
        
        # Update UI
        self.total_weight_var.set(f"Total Weight: {total_weight_force/self.GRAVITY:.2f} kg")
        self.total_buoyancy_var.set(f"Total Buoyancy: {total_buoyancy_force:.2f} N")
        self.safety_factor_var.set(f"Safety Factor: {overall_safety:.2f}")
        
        # Format block summary
        block_summary = ", ".join([f"{int(count)} x {block_type}" for block_type, count in blocks_by_type.items()])
        self.total_blocks_var.set(f"Total Blocks: {int(total_blocks * 2)} ({block_summary})") #added * 2 for sandwich block
        
        # Visualization
        self.plot_results(section_names, section_safety_factors)
        
        # Check if safety factor is below threshold
        threshold = self.safety_factor_threshold.get()
        if overall_safety < threshold:
            messagebox.warning("Warning", f"Overall safety factor {overall_safety:.2f} is below threshold {threshold}")
        
        # Show detailed results
        self.show_detailed_results(safety_by_section, overall_safety)
    
    def plot_results(self, names, safety_factors):
        self.ax.clear()
        
        # Color bars based on safety threshold
        threshold = self.safety_factor_threshold.get()
        colors = ['red' if sf < threshold else 'green' for sf in safety_factors]
        
        bars = self.ax.bar(names, safety_factors, color=colors)
        
        # Add threshold line
        self.ax.axhline(y=threshold, color='r', linestyle='--', alpha=0.7)
        
        self.ax.set_title('Safety Factor by Section')
        self.ax.set_ylabel('Safety Factor')
        self.ax.set_ylim(bottom=0)
        
        # Add value labels on top of bars
        for bar in bars:
            height = bar.get_height()
            self.ax.text(bar.get_x() + bar.get_width()/2., height,
                    f'{height:.2f}', ha='center', va='bottom')
        
        plt.tight_layout()
        self.canvas.draw()
    
    def show_detailed_results(self, safety_by_section, overall_safety):
        results_window = tk.Toplevel(self.root)
        results_window.title("Detailed Results")
        results_window.geometry("600x400")
        
        frame = ttk.Frame(results_window, padding="10")
        frame.pack(fill=tk.BOTH, expand=True)
        
        # Overall results
        ttk.Label(frame, text=f"Overall Safety Factor: {overall_safety:.2f}", font=("Arial", 12, "bold")).pack(anchor=tk.W)
        
        # Section results
        results_tree = ttk.Treeview(
            frame, 
            columns=("name", "safety", "buoyancy", "pipe_weight", "block_weight", "net"),
            show="headings"
        )
        
        results_tree.heading("name", text="Section")
        results_tree.heading("safety", text="Safety Factor")
        results_tree.heading("buoyancy", text="Buoyancy (N)")
        results_tree.heading("pipe_weight", text="Pipe Weight (N)")
        results_tree.heading("block_weight", text="Block Weight (N)")
        results_tree.heading("net", text="Net Force (N)")
        
        results_tree.column("name", width=80)
        results_tree.column("safety", width=80)
        results_tree.column("buoyancy", width=100)
        results_tree.column("pipe_weight", width=100)
        results_tree.column("block_weight", width=100)
        results_tree.column("net", width=100)
        
        for section in safety_by_section:
            results_tree.insert("", tk.END, values=(
                section["name"],
                f"{section['safety_factor']:.2f}",
                f"{section['buoyancy']:.2f}",
                f"{section['pipe_weight']:.2f}",
                f"{section['block_weight']:.2f}",
                f"{section['net_force']:.2f}"
            ))
        
        results_tree.pack(fill=tk.BOTH, expand=True, pady=10)
        
        ttk.Button(frame, text="Close", command=results_window.destroy).pack(pady=10)

if __name__ == "__main__":
    root = tk.Tk()
    app = PipeBuoyancyCalculator(root)
    root.mainloop()
import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np

class BasicPipeBuoyancyCalculator:
    def __init__(self, root):
        self.root = root
        self.root.title("Pipe Buoyancy Calculator")
        self.root.geometry("700x700")
        
        # Material densities (kg/m³)
        self.materials = {
            "HDPE": 950,
            "PVC": 1400,
            "Steel": 7850,
            "Cast Iron": 7200,
            "Stainless Steel": 8000,
            "Copper": 8940,
            "Aluminum": 2700
        }
        
        # Fill fluid densities (kg/m³)
        self.fluids = {
            "Air": 1.225,
            "Fresh Water": 1000,
            "Seawater": 1025 #,
            # "Oil (light)": 800,
            # "Oil (heavy)": 900,
            # "Natural Gas": 0.8
        }
        
        self.seawater_density = 1025  # kg/m³
        self.concrete_density = 2400  # kg/m³
        self.gravity = 9.81  # m/s²
        
        self.safety_factor = 1.5  # Default safety factor
        self.marine_growth_thickness = 0.0  # Default marine growth thickness in meters
        self.marine_growth_density = 1300  # kg/m³
        
        self.pipes = []  # Will store all pipe configurations
        
        self.create_widgets()
    
    def create_widgets(self):
        # Main frame
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Pipe Configuration Frame
        pipe_frame = ttk.LabelFrame(main_frame, text="Pipe Configuration", padding="4")
        pipe_frame.pack(fill=tk.X, padx=3, pady=3)
        
        # Pipe dimensions
        ttk.Label(pipe_frame, text="Outer Diameter (mm):").grid(row=0, column=0, sticky=tk.W, padx=5, pady=2)
        self.outer_diameter_var = tk.StringVar(value="32")
        ttk.Entry(pipe_frame, textvariable=self.outer_diameter_var, width=10).grid(row=0, column=1, padx=5, pady=2)
        
        ttk.Label(pipe_frame, text="Wall Thickness (mm):").grid(row=1, column=0, sticky=tk.W, padx=5, pady=2)
        self.wall_thickness_var = tk.StringVar(value="3")
        ttk.Entry(pipe_frame, textvariable=self.wall_thickness_var, width=10).grid(row=1, column=1, padx=5, pady=2)
        
        ttk.Label(pipe_frame, text="Length (m):").grid(row=2, column=0, sticky=tk.W, padx=5, pady=2)
        self.length_var = tk.StringVar(value="500")
        ttk.Entry(pipe_frame, textvariable=self.length_var, width=10).grid(row=2, column=1, padx=5, pady=2)
        
        ttk.Label(pipe_frame, text="Quantity:").grid(row=3, column=0, sticky=tk.W, padx=5, pady=2)
        self.quantity_var = tk.StringVar(value="1")
        ttk.Entry(pipe_frame, textvariable=self.quantity_var, width=10).grid(row=3, column=1, padx=5, pady=2)
        
        # Material selection
        ttk.Label(pipe_frame, text="Pipe Material:").grid(row=0, column=2, sticky=tk.W, padx=5, pady=2)
        self.material_var = tk.StringVar(value="HDPE")
        material_combo = ttk.Combobox(pipe_frame, textvariable=self.material_var, width=15)
        material_combo['values'] = list(self.materials.keys())
        material_combo.grid(row=0, column=3, padx=5, pady=2)
        
        # Fill fluid selection
        ttk.Label(pipe_frame, text="Fill Fluid:").grid(row=1, column=2, sticky=tk.W, padx=5, pady=2)
        self.fluid_var = tk.StringVar(value="Air")
        fluid_combo = ttk.Combobox(pipe_frame, textvariable=self.fluid_var, width=15)
        fluid_combo['values'] = list(self.fluids.keys())
        fluid_combo.grid(row=1, column=3, padx=5, pady=2)
        
        # Add pipe button
        ttk.Button(pipe_frame, text="Add Pipe Configuration", command=self.add_pipe).grid(row=4, column=0, columnspan=4, pady=10)
        
        # Pipes list frame
        pipes_list_frame = ttk.LabelFrame(main_frame, text="Pipe Configurations", padding="10")
        pipes_list_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Scrollable list for pipes
        scrollbar = ttk.Scrollbar(pipes_list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.pipes_listbox = tk.Listbox(pipes_list_frame, height=2, width=80)
        self.pipes_listbox.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.pipes_listbox.config(yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.pipes_listbox.yview)
        
        # Remove selected pipe button
        ttk.Button(pipes_list_frame, text="Remove Selected", command=self.remove_pipe).pack(pady=5)
        
        # Advanced settings frame
        adv_frame = ttk.LabelFrame(main_frame, text="Advanced Settings", padding="10")
        adv_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # Safety factor
        ttk.Label(adv_frame, text="Safety Factor:").grid(row=0, column=0, sticky=tk.W, padx=5, pady=2)
        self.safety_factor_var = tk.StringVar(value="1.5")
        ttk.Entry(adv_frame, textvariable=self.safety_factor_var, width=10).grid(row=0, column=1, padx=5, pady=2)
        
        # Marine growth
        ttk.Label(adv_frame, text="Marine Growth Thickness (mm):").grid(row=1, column=0, sticky=tk.W, padx=5, pady=2)
        self.marine_growth_var = tk.StringVar(value="0")
        ttk.Entry(adv_frame, textvariable=self.marine_growth_var, width=10).grid(row=1, column=1, padx=5, pady=2)
        
        # Concrete settings frame
        concrete_frame = ttk.LabelFrame(main_frame, text="Concrete Ballast", padding="10")
        concrete_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(concrete_frame, text="Unit Block Weight (kg):").grid(row=0, column=0, sticky=tk.W, padx=5, pady=2)
        self.block_weight_var = tk.StringVar(value="12")
        ttk.Entry(concrete_frame, textvariable=self.block_weight_var, width=10).grid(row=0, column=1, padx=5, pady=2)
        
        # Calculate button
        ttk.Button(main_frame, text="Calculate Required Concrete Weight", 
                  command=self.calculate).pack(pady=10)
        
        # Results frame
        results_frame = ttk.LabelFrame(main_frame, text="Results", padding="10")
        results_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.results_text = tk.Text(results_frame, height=6, width=80)
        self.results_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        self.results_text.config(state=tk.DISABLED)
    
    def add_pipe(self):
        try:
            outer_diameter = float(self.outer_diameter_var.get()) / 1000  # Convert to meters
            wall_thickness = float(self.wall_thickness_var.get()) / 1000  # Convert to meters
            length = float(self.length_var.get())
            quantity = int(self.quantity_var.get())
            material = self.material_var.get()
            fluid = self.fluid_var.get()
            
            if outer_diameter <= 0 or wall_thickness <= 0 or length <= 0 or quantity <= 0:
                messagebox.showerror("Error", "All values must be positive numbers.")
                return
                
            if wall_thickness * 2 >= outer_diameter:
                messagebox.showerror("Error", "Wall thickness is too large for the given diameter.")
                return
            
            pipe_config = {
                "outer_diameter": outer_diameter,
                "wall_thickness": wall_thickness,
                "length": length,
                "quantity": quantity,
                "material": material,
                "fluid": fluid
            }
            
            self.pipes.append(pipe_config)
            self.update_pipes_listbox()
            
        except ValueError:
            messagebox.showerror("Error", "Please enter valid numbers for all fields.")
    
    def remove_pipe(self):
        try:
            selected_idx = self.pipes_listbox.curselection()[0]
            self.pipes.pop(selected_idx)
            self.update_pipes_listbox()
        except IndexError:
            messagebox.showerror("Error", "Please select a pipe configuration to remove.")
    
    def update_pipes_listbox(self):
        self.pipes_listbox.delete(0, tk.END)
        for i, pipe in enumerate(self.pipes):
            desc = f"{i+1}. OD: {pipe['outer_diameter']*1000:.1f}mm, Wall: {pipe['wall_thickness']*1000:.1f}mm, " \
                   f"Length: {pipe['length']:.1f}m, Qty: {pipe['quantity']}, " \
                   f"Material: {pipe['material']}, Fill: {pipe['fluid']}"
            self.pipes_listbox.insert(tk.END, desc)
    
    def calculate_pipe_buoyancy(self, pipe):
        # Extract pipe parameters
        od = pipe["outer_diameter"]  # m
        wt = pipe["wall_thickness"]  # m
        length = pipe["length"]  # m
        quantity = pipe["quantity"]
        material_density = self.materials[pipe["material"]]  # kg/m³
        fluid_density = self.fluids[pipe["fluid"]]  # kg/m³
        
        # Calculate dimensions
        id_pipe = od - 2 * wt  # Inner diameter (m)
        
        # Calculate volumes
        pipe_volume = np.pi/4 * (od**2 - id_pipe**2) * length  # m³
        internal_volume = np.pi/4 * id_pipe**2 * length  # m³
        
        # Calculate volumes with marine growth if applicable
        marine_growth_thickness = float(self.marine_growth_var.get()) / 1000  # m
        if marine_growth_thickness > 0:
            od_with_growth = od + 2 * marine_growth_thickness
            marine_growth_volume = np.pi/4 * (od_with_growth**2 - od**2) * length  # m³
            marine_growth_weight = marine_growth_volume * self.marine_growth_density
            displaced_volume = np.pi/4 * od_with_growth**2 * length  # m³
        else:
            marine_growth_weight = 0
            displaced_volume = np.pi/4 * od**2 * length  # m³
        
        # Calculate weights
        pipe_weight = pipe_volume * material_density  # kg
        internal_fluid_weight = internal_volume * fluid_density  # kg
        buoyancy_force = displaced_volume * self.seawater_density * self.gravity  # N
        
        # Total weight of pipe with contents
        total_weight = (pipe_weight + internal_fluid_weight + marine_growth_weight) * self.gravity  # N
        
        # Net buoyancy (negative means sinking, positive means floating)
        net_buoyancy = buoyancy_force - total_weight  # N
        
        # Apply safety factor if the pipe is buoyant
        if net_buoyancy > 0:
            required_weight = net_buoyancy * float(self.safety_factor_var.get()) / self.gravity  # kg
        else:
            required_weight = 0  # If pipe sinks naturally, no additional weight needed
            
        # Multiply by quantity
        total_required_weight = required_weight * quantity
        
        return {
            "net_buoyancy": net_buoyancy * quantity,
            "required_weight": total_required_weight,
            "pipe_weight": pipe_weight * quantity,
            "fluid_weight": internal_fluid_weight * quantity,
            "marine_growth_weight": marine_growth_weight * quantity,
            "total_displacement": displaced_volume * quantity
        }
    
    def calculate(self):
        if not self.pipes:
            messagebox.showerror("Error", "Please add at least one pipe configuration.")
            return
            
        try:
            total_required_weight = 0
            total_buoyancy = 0
            results = []
            
            for pipe in self.pipes:
                pipe_result = self.calculate_pipe_buoyancy(pipe)
                total_required_weight += pipe_result["required_weight"]
                total_buoyancy += pipe_result["net_buoyancy"]
                results.append(pipe_result)
            
            # Calculate number of concrete blocks needed
            block_weight = float(self.block_weight_var.get())  # kg
            if block_weight <= 0:
                messagebox.showerror("Error", "Block weight must be positive.")
                return
                
            num_blocks = np.ceil(total_required_weight / block_weight)
            actual_weight = num_blocks * block_weight
            
            # Display results
            self.results_text.config(state=tk.NORMAL)
            self.results_text.delete(1.0, tk.END)
            
            if total_buoyancy <= 0:
                self.results_text.insert(tk.END, "The pipes are naturally submerged (not buoyant).\n")
                self.results_text.insert(tk.END, f"Net downward force: {-total_buoyancy/1000:.2f} kN\n")
            else:
                self.results_text.insert(tk.END, f"Total buoyancy force: {total_buoyancy/1000:.2f} kN\n")
                self.results_text.insert(tk.END, f"Required concrete weight: {total_required_weight:.2f} kg\n")
                self.results_text.insert(tk.END, f"Number of concrete blocks needed: {int(num_blocks)}\n")
                self.results_text.insert(tk.END, f"Total concrete weight: {actual_weight:.2f} kg\n")
                
                if actual_weight > total_required_weight:
                    margin = actual_weight - total_required_weight
                    self.results_text.insert(tk.END, f"Weight margin: {margin:.2f} kg extra weight provided\n")
            
            self.results_text.config(state=tk.DISABLED)
            
        except ValueError as e:
            messagebox.showerror("Error", f"Calculation error: {str(e)}")

def main():
    root = tk.Tk()
    app = PipeBuoyancyCalculator(root) #claude sonnet 3.7 generated code
    root.mainloop()

if __name__ == "__main__":
    main()